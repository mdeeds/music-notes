document.addEventListener('DOMContentLoaded', () => {
  const editableArea = document.getElementById('editable-area');
  const resolutionMultiplier = 2;
  const eraserWidth = 10;
  const pencilWidth = 2;
  const localStorageKeyBase = 'editableMusicNotation_';
  const stateKey = `${localStorageKeyBase}state`;

  // --- Utility Functions ---

  // Debounce function to limit frequency of saves
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Generate a simple unique ID
  function generateId() {
    return `staff_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // --- State Management ---


  // Creates the JSON object representing the state of the page.
  function buildStateObject() {
    const state = {
      content: editableArea.innerHTML,
      canvases: {}
    };

    const containers = editableArea.querySelectorAll('.staff-container');
    containers.forEach(container => {
      const id = container.dataset.id;
      if (!id) {
        console.warn("Container found without ID during save:", container);
        return;
      }
      const fgCanvas = container.querySelector('canvas.drawing-area');
      if (fgCanvas) {
        try {
          const dataUrl = fgCanvas.toDataURL('image/png');
          state.canvases[id] = dataUrl;
        } catch (e) {
          console.error(`Error saving canvas ${id}:`, e);
        }
      }
    });

    return state;
  }

  // Function to save the entire state to localStorage
  const saveState = debounce(() => {
    const state = buildStateObject();
    try {
      localStorage.setItem(stateKey, JSON.stringify(state));
    } catch (error) {
      console.error("Error saving state to localStorage:", error);
      if (error.name === 'QuotaExceededError') {
        alert("Could not save changes. Local storage quota might be exceeded. Try removing some staves.");
      }
    }

  }, 1000); // Debounce saving by 1 second


  function loadStateFromObject(savedState) {
    const savedContent = savedState.content;

    if (savedContent) {
      editableArea.innerHTML = savedContent;

      // Re-initialize all staff containers found in the loaded content
      editableArea.querySelectorAll('.staff-container').forEach(container => {
        initializeStaffContainer(container);
        const id = container.dataset.id;
        const fgCanvas = container.querySelector('canvas.drawing-area');
        const fgCtx = fgCanvas.getContext('2d');
        const savedImageDataUrl = savedState.canvases[id];
        if (savedImageDataUrl) {
          loadImageOntoCanvas(savedImageDataUrl, fgCanvas, fgCtx);
        }

      });
      console.log("State loaded.");
    } else {
      // Set default content if nothing is saved
      editableArea.innerHTML = 'Start typing here... or double-click to add a staff.<br><br>';
      console.log("No saved state found, initialized default content.");
    }
    // Ensure focus is reasonable after load
    editableArea.focus();
  }

  // Function to load state from localStorage
  function loadState() {
    console.log("Loading state...");
    const savedState = JSON.parse(localStorage.getItem(stateKey) || '{}');
    loadStateFromObject(savedState);
  }

  // Function to initialize or re-initialize a staff container (used on load and creation)
  function initializeStaffContainer(container) {
    const id = container.dataset.id;
    if (!id) {
      console.error("Cannot initialize container without data-id", container);
      return;
    }

    const bgCanvas = container.querySelector('canvas.staff-lines');
    const fgCanvas = container.querySelector('canvas.drawing-area');
    const buttonContainer = container.querySelector('.tool-buttons');
    const writeButton = buttonContainer?.querySelector('button[data-tool="write"]');
    const eraseButton = buttonContainer?.querySelector('button[data-tool="erase"]');

    if (!bgCanvas || !fgCanvas || !buttonContainer || !writeButton || !eraseButton) {
      console.error("Incomplete staff container structure for ID:", id, container);
      // Optionally remove the broken container here
      // container.remove();
      return;
    }

    // --- Recalculate Sizes (Important for responsiveness) ---
    const containerPadding = parseFloat(window.getComputedStyle(editableArea).paddingLeft) + parseFloat(window.getComputedStyle(editableArea).paddingRight);
    const availableWidth = editableArea.clientWidth - containerPadding;
    const displayHeight = 64; // Keep display height consistent
    const finalDisplayWidth = availableWidth > 100 ? availableWidth : 400;


    // --- Configure BOTH Canvases ---
    [bgCanvas, fgCanvas].forEach(canvas => {
      canvas.style.width = `${finalDisplayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      canvas.width = finalDisplayWidth * resolutionMultiplier;
      canvas.height = displayHeight * resolutionMultiplier;
      const ctx = canvas.getContext('2d');
      // Clear previous scaling if re-initializing
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(resolutionMultiplier, resolutionMultiplier);
    });


    // --- Redraw Staff Lines ---
    const bgCtx = bgCanvas.getContext('2d');
    drawStaffLines(bgCanvas, bgCtx);

    const fgCtx = fgCanvas.getContext('2d');
    fgCtx.clearRect(0, 0, finalDisplayWidth, displayHeight);

    // --- Re-attach Listeners ---
    addDrawingListeners(fgCanvas, fgCtx, container); // Pass fg canvas, its context, and the container

    // Remove old listeners before adding new ones to prevent duplicates if re-initializing
    buttonContainer.replaceWith(buttonContainer.cloneNode(true)); // Simple way to remove listeners
    const newButtonContainer = container.querySelector('.tool-buttons'); // Get the new clone
    const newWriteButton = newButtonContainer.querySelector('button[data-tool="write"]');
    const newEraseButton = newButtonContainer.querySelector('button[data-tool="erase"]');

    newButtonContainer.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        const selectedTool = e.target.dataset.tool;
        container.dataset.tool = selectedTool;
        newWriteButton.classList.toggle('active', selectedTool === 'write');
        newEraseButton.classList.toggle('active', selectedTool === 'erase');
        // No need to save state here, drawing/input events handle it
      }
    });

    // --- Set Correct Active Button ---
    const currentTool = container.dataset.tool || 'write'; // Default to write if unset
    container.dataset.tool = currentTool; // Ensure dataset is set
    newWriteButton.classList.toggle('active', currentTool === 'write');
    newEraseButton.classList.toggle('active', currentTool === 'erase');

    // Make container non-editable (important after innerHTML replacement)
    container.contentEditable = false;
  }


  // --- Event Listeners Setup ---

  const copyJsonButton = document.getElementById('copy-json-button');
  copyJsonButton.addEventListener('click', () => {
    try {
      const state = buildStateObject();
      const jsonString = JSON.stringify(state, null, 2); // Pretty print

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(jsonString).then(() => {
          // Provide feedback
          const originalText = copyJsonButton.textContent;
          copyJsonButton.textContent = 'Copied!';
          setTimeout(() => { copyJsonButton.textContent = originalText; }, 2000);
        }).catch(err => {
          console.error('Failed to copy JSON to clipboard:', err);
          alert('Failed to copy JSON. See console for details.');
          // Fallback: Manually select text in paste area
          if (pasteJsonArea) {
            pasteJsonArea.value = jsonString;
            pasteJsonArea.select();
            alert("Could not copy automatically. JSON is selected in the text box - please copy it manually (Ctrl+C / Cmd+C).");
          }
        });
      } else {
        // Fallback for older browsers or insecure contexts
        if (pasteJsonArea) {
          pasteJsonArea.value = jsonString;
          pasteJsonArea.select();
          alert("Automatic copy not supported. JSON is selected in the text box - please copy it manually (Ctrl+C / Cmd+C).");
        } else {
          alert("Clipboard API not available.");
        }
      }
    } catch (error) {
      console.error("Error generating JSON for copying:", error);
      alert("Could not generate JSON data. See console for details.");
    }
  });

  const pasteJsonArea = document.getElementById('paste-json');
  const loadJsonButon = document.getElementById('load-json-button');
  loadJsonButon.addEventListener('click', () => {
    const jsonString = pasteJsonArea.value;
    try {
      const state = JSON.parse(jsonString);
      loadStateFromObject(state);
      saveState(); // Save after loading
    } catch (error) {
      console.error(error);
    }
  });


  // Listener for creating new staves
  editableArea.addEventListener('dblclick', (event) => {
    if (event.target.closest('.staff-container')) return;
    event.preventDefault();

    const container = document.createElement('div');
    container.classList.add('staff-container');
    const newId = generateId(); // Generate unique ID
    container.dataset.id = newId; // Assign ID
    container.dataset.tool = 'write'; // Default tool

    container.innerHTML = `
          <canvas class="staff-lines"></canvas>
          <canvas class="drawing-area"></canvas>
          <div class="tool-buttons">
              <button type="button" class="active" data-tool="write" title="Write">w</button>
              <button type="button" data-tool="erase" title="Erase">e</button>
          </div>
      `;

    // Insert the container structure
    insertNodeAtCursor(container);
    // Initialize the newly created container (sets sizes, draws lines, adds listeners)
    initializeStaffContainer(container);

    editableArea.focus();
    saveState(); // Save state immediately after adding a new staff
  });

  // Listener for text changes
  editableArea.addEventListener('input', () => {
    // Only trigger save if the event wasn't inside a non-editable container
    if (document.activeElement === editableArea || !editableArea.contains(document.activeElement) || document.activeElement.closest('.staff-container') === null) {
      saveState();
    }
  });

  // --- Helper Functions (Drawing, Insertion, etc.) ---
  function loadImageOntoCanvas(savedImageDataUrl, fgCanvas, fgCtx) {
    const img = new Image();
    img.onload = () => {
      // Draw the loaded image onto the foreground canvas
      // Ensure context is scaled correctly before drawing
      fgCtx.save();
      // Reset transform needed if drawing image directly onto scaled context
      fgCtx.setTransform(resolutionMultiplier, 0, 0, resolutionMultiplier, 0, 0);
      fgCtx.drawImage(img, 0, 0, fgCanvas.width / resolutionMultiplier, fgCanvas.height / resolutionMultiplier); // Draw using display dimensions
      fgCtx.restore(); // Restore original scaled transform
      console.log(`Loaded drawing for canvas`);
    };
    img.onerror = () => {
      console.error(`Failed to load image data for canvas`);
    };
    img.src = savedImageDataUrl;
  }

  function drawStaffLines(canvas, ctx) {
    const numLines = 5;
    const ledgerSpace = 4;
    const displayHeight = parseFloat(canvas.style.height);
    const displayWidth = parseFloat(canvas.style.width);
    const lineSpacing = displayHeight / (numLines + ledgerSpace - 1);

    ctx.save();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1; // Keep line width consistent regardless of multiplier for visual clarity
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    for (let i = 0; i < numLines; i++) {
      const y = Math.round(lineSpacing * (i + ledgerSpace / 2));
      ctx.beginPath();
      ctx.moveTo(5, y);
      ctx.lineTo(displayWidth - 5, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function addDrawingListeners(canvas, ctx, container) {
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    function getCoords(event) {
      const rect = canvas.getBoundingClientRect();
      let clientX, clientY;
      if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return { x, y };
    }

    function startDrawing(event) {
      // Prevent drawing if inside a non-editable container but not on the canvas itself
      if (event.target !== canvas) return;

      isDrawing = true;
      const coords = getCoords(event);
      [lastX, lastY] = [coords.x, coords.y];

      const currentTool = container.dataset.tool;
      ctx.save(); // Save context state before changing composite op/line width
      if (currentTool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = eraserWidth;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = pencilWidth;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
    }

    function draw(event) {
      if (!isDrawing) return;
      // Prevent drawing if inside a non-editable container but not on the canvas itself
      if (event.target !== canvas && !(event.touches && event.touches[0].target === canvas)) return;

      if (event.touches) event.preventDefault();

      const coords = getCoords(event);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      [lastX, lastY] = [coords.x, coords.y];
    }

    function stopDrawing(event) {
      // Check if drawing was actually happening before restoring/saving
      if (!isDrawing) return;
      // Prevent saving if mouse up happens outside the canvas while drawing
      // if (event.target !== canvas && !(event.touches && event.touches.length === 0)) return;


      isDrawing = false;
      ctx.restore(); // Restore context state (composite op, line width)
      saveState(); // Trigger save after drawing/erasing is finished
    }

    // Use event capturing on the container for mouse events to better handle mouseout
    const eventOptions = { passive: false }; // Needed for preventDefault on touchmove
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    // Listen on window for mouseup/touchend to ensure drawing stops even if cursor leaves canvas
    window.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', (e) => {
      // Optional: Only stop if mouse button is not pressed (allows continuing drawing outside and back in)
      // if (isDrawing && e.buttons === 0) { stopDrawing(e); }
    });

    canvas.addEventListener('touchstart', startDrawing, eventOptions);
    canvas.addEventListener('touchmove', draw, eventOptions);
    window.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);
  }

  function insertNodeAtCursor(node) {
    const selection = window.getSelection();
    if (!selection.rangeCount) { // If no selection/range, append to end
      editableArea.appendChild(node);
      return;
    }

    let range = selection.getRangeAt(0);

    // Ensure insertion point is directly within editableArea or a text node within it
    let container = range.startContainer;
    while (container !== editableArea && container.parentNode !== editableArea) {
      if (container.parentNode) {
        container = container.parentNode;
      } else {
        // Failsafe: append if we can't find a valid parent node
        editableArea.appendChild(node);
        return;
      }
    }

    // Standard insertion at cursor/selection
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node); // Move cursor after inserted node

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // --- Initial Load ---
  loadState();

});