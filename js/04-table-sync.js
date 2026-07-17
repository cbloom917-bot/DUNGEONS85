// Dungeons '85 Public Beta 9.7.3.4.11.1 — 04-table-sync.js
// Ordered client module. Preserve script load order in index.html.

// ============================================================
// Fog of War, darkness, and table-state broadcasting
// ============================================================

function toggleFogPanel() {
        if (!tableState.isDM) return;
        document.getElementById('fog-panel').classList.toggle('hidden');
    }


function broadcastFoW() {
        if (!tableState.isDM || !socket) return;
        socket.emit('updateFoW', { 
            enabled: tableState.fowEnabled, 
            polygons: tableState.fowPolygons,
            darkness: tableState.isDarknessActive 
        });
    }
async function broadcastFullTableState({ reason = 'full-table-state', loadId = '' } = {}) {
        if (!tableState.isDM || !socket) {
            return { ok: false, code: 'MAP_TRANSFER_UNAVAILABLE' };
        }

        // Reserve the map lane before any imported table state is sent. Once the
        // server grants it, send Fog first and only then submit the large map.
        const mapResult = await sendMapUpdateWithBackpressure(tableState.mapSrc || '', {
            reason,
            loadId,
            beforeSend: () => broadcastFoW()
        });
        if (!mapResult.ok) return mapResult;

        broadcastTokensMatrixChange();
        broadcastNotes();
        broadcastSketches();
        return mapResult;
    }

function toggleFogMode() {
        if (!tableState.isDM) return;
        tableState.fowEnabled = !tableState.fowEnabled;
        if (!tableState.fowEnabled) {
            isDrawingFoW = false; 
            currentFoWPolygon = [];
        }
        updateFogUI();
        markTableDirty();
        broadcastFoW();
        draw();
    }


function toggleFogDraw() {
        if (!tableState.isDM || !tableState.fowEnabled) return;
        isDrawingFoW = !isDrawingFoW;
        currentFoWPolygon = [];
        updateFogUI();
        draw();
    }


function resetFog() {
        if (!tableState.isDM) return;
        tableState.fowPolygons = [];
        currentFoWPolygon = [];
        isDrawingFoW = false;
        updateFogUI();
        markTableDirty();
        broadcastFoW();
        draw();
    }


function updateFogUI() {
    const btnToggle = document.getElementById('btn-fog-toggle');
    const btnDraw = document.getElementById('btn-fog-draw');
    const btnReset = document.getElementById('btn-fog-reset');

    if (!btnToggle) return;

    if (tableState.fowEnabled) {
        btnToggle.innerText = "Disable Fog";
        btnToggle.style.background = "#fff";
        btnToggle.style.color = "#000";
        btnDraw.style.display = "block";
        btnReset.style.display = "block";
    } else {
        btnToggle.innerText = "Enable Fog";
        btnToggle.style.background = "#000";
        btnToggle.style.color = "#fff";
        btnDraw.style.display = "none";
        btnReset.style.display = "none";
    }

    if (isDrawingFoW) {
        btnDraw.innerText = "[ PLOTTING ]";
        btnDraw.style.background = "#ff3333";
        btnDraw.style.color = "#fff";
        btnDraw.style.borderColor = "#ff3333";
        document.getElementById('vtt-canvas').classList.add('plotting');
    } else {
        btnDraw.innerText = "PLOT REVEAL";
        btnDraw.style.background = "#000";
        btnDraw.style.color = "#fff";
        btnDraw.style.borderColor = "#fff";
        document.getElementById('vtt-canvas').classList.remove('plotting');
    }
}


function sanitizeSketchesForBroadcast() {
    if (!Array.isArray(tableState.sketches)) tableState.sketches = [];

    return tableState.sketches.map(sketch => ({
        id: String(sketch.id),
        type: String(sketch.type || ''),
        x1: Number(sketch.x1) || 0,
        y1: Number(sketch.y1) || 0,
        x2: Number(sketch.x2) || 0,
        y2: Number(sketch.y2) || 0,
        color: String(sketch.color || '#000000')
    })).filter(sketch => ['line', 'circle', 'rect'].includes(sketch.type));
}

function broadcastSketches() {
    if (!tableState.isDM || !socket) return;
    socket.emit('updateSketches', sanitizeSketchesForBroadcast());
}

function getSketchToolButton(tool) {
    return document.getElementById(`btn-sketch-${tool}`);
}

function updateSketchToolUI() {
    ['line', 'circle', 'rect', 'eraser'].forEach(tool => {
        const btn = getSketchToolButton(tool);
        if (!btn) return;

        btn.classList.toggle('active', activeSketchTool === tool);
        btn.classList.remove('sketch-color-white');
        btn.style.removeProperty('--sketch-icon-color');

        if (activeSketchTool !== tool) {
            btn.style.color = '';
            return;
        }

        if (tool === 'eraser') {
            btn.style.setProperty('--sketch-icon-color', '#000000');
            return;
        }

        const color = SKETCH_COLORS[sketchToolColors[tool] || 0];
        btn.style.setProperty('--sketch-icon-color', color.value);
        if (color.name === 'white') btn.classList.add('sketch-color-white');
    });

    const canvasEl = document.getElementById('vtt-canvas');
    if (canvasEl) {
        canvasEl.classList.toggle('sketching', !!activeSketchTool && activeSketchTool !== 'eraser');
        canvasEl.classList.toggle('erasing-sketch', activeSketchTool === 'eraser');
    }
}

function selectSketchTool(tool) {
    if (!tableState.isDM) return;
    if (!['line', 'circle', 'rect', 'eraser'].includes(tool)) return;

    if (activeSketchTool === tool && tool !== 'eraser') {
        const currentColorIndex = sketchToolColors[tool] || 0;
        const nextColorIndex = currentColorIndex + 1;

        if (nextColorIndex >= SKETCH_COLORS.length) {
            sketchToolColors[tool] = 0;
            clearSketchTool();
            return;
        }

        sketchToolColors[tool] = nextColorIndex;
    } else {
        activeSketchTool = tool;
        sketchDraft = null;
        if (isDrawingFoW) {
            isDrawingFoW = false;
            currentFoWPolygon = [];
            updateFogUI();
        }
    }

    updateSketchToolUI();
    draw();
}

function clearSketchTool() {
    activeSketchTool = null;
    sketchDraft = null;
    updateSketchToolUI();
    draw();
}


function getLeanToken(token) {
        return {
            id: token.id,
            src: token.src,
            x: token.x,
            y: token.y,
            size: token.size,
            hidden: token.hidden,
            rev: token.rev || 0
        };
    }

function broadcastTokensMatrixChange() {
        if (!tableState.isDM || !socket) return;
        socket.emit('updateTokensMatrix', tableState.tokens.map(getLeanToken));
    }

function emitTokenMove(token) {
        if (!socket || !token) return;
        socket.emit('tokenMove', { id: token.id, x: token.x, y: token.y });
    }

function emitTokenResize(token) {
        if (!tableState.isDM || !socket || !token) return;
        socket.emit('tokenResize', { id: token.id, size: token.size });
    }

function emitTokenVisibility(token) {
        if (!tableState.isDM || !socket || !token) return;
        socket.emit('tokenVisibility', { id: token.id, hidden: token.hidden });
    }

function emitTokenAdd(token) {
        if (!tableState.isDM || !socket || !token) return;
        socket.emit('tokenAdd', getLeanToken(token));
    }

function emitTokenDelete(tokenId) {
        if (!tableState.isDM || !socket || !tokenId) return;
        socket.emit('tokenDelete', { id: tokenId });
    }







function sanitizeNotesForBroadcast() {
    if (!Array.isArray(tableState.notes)) tableState.notes = [];

    return tableState.notes.map(note => ({
        id: String(note.id),
        x: Number(note.x) || 0,
        y: Number(note.y) || 0,
        label: String(note.label || '').substring(0, 40),
        body: String(note.body || '').substring(0, 1000)
    }));
}

function broadcastNotes() {
    if (!tableState.isDM || !socket) return;
    socket.emit('updateNotes', sanitizeNotesForBroadcast());
}

function toggleNotesVisibility() {
    if (!tableState.isDM) return;
    notesVisible = !notesVisible;
    updateNotesToggleUI();
    closeNoteEditor(false);
    draw();
}

function updateNotesToggleUI() {
    const btn = document.getElementById('btn-notes-toggle');
    if (!btn) return;

    btn.innerText = 'NOTES';

    if (notesVisible) {
        btn.style.background = '#fff';
        btn.style.color = '#000';
    } else {
        btn.style.background = '#000';
        btn.style.color = '#fff';
    }
}

function openNoteEditor(note, worldX, worldY, screenX, screenY) {
    if (!tableState.isDM || !notesVisible) return;

    const editor = document.getElementById('note-editor');
    const labelInput = document.getElementById('note-label-input');
    const bodyInput = document.getElementById('note-body-input');
    const deleteBtn = document.getElementById('btn-note-delete');

    if (!editor || !labelInput || !bodyInput || !deleteBtn) return;

    openNoteId = note ? note.id : null;
    pendingNoteWorldPosition = note ? null : { x: worldX, y: worldY };

    labelInput.value = note ? (note.label || '') : '';
    bodyInput.value = note ? (note.body || '') : '';
    deleteBtn.style.display = note ? 'block' : 'none';

    editor.style.left = `${Math.min(screenX, window.innerWidth - 260)}px`;
    editor.style.top = `${Math.min(screenY, window.innerHeight - 220)}px`;
    editor.classList.remove('hidden');
    labelInput.focus();
}

function closeNoteEditor(redraw = true) {
    const editor = document.getElementById('note-editor');
    if (editor) editor.classList.add('hidden');

    openNoteId = null;
    pendingNoteWorldPosition = null;

    if (redraw) draw();
}

function saveOpenNote() {
    if (!tableState.isDM) return;

    const labelInput = document.getElementById('note-label-input');
    const bodyInput = document.getElementById('note-body-input');
    if (!labelInput || !bodyInput) return;

    const label = labelInput.value.trim().substring(0, 40);
    const body = bodyInput.value.trim().substring(0, 1000);

    if (!body && !label) {
        closeNoteEditor();
        return;
    }

    if (!Array.isArray(tableState.notes)) tableState.notes = [];

    if (openNoteId) {
        const note = tableState.notes.find(n => n.id === openNoteId);
        if (note) {
            note.label = label;
            note.body = body;
        }
    } else if (pendingNoteWorldPosition) {
        tableState.notes.push({
            id: `note-${Date.now()}-${Math.random()}`,
            x: pendingNoteWorldPosition.x,
            y: pendingNoteWorldPosition.y,
            label,
            body
        });
    }

    closeNoteEditor(false);
    markTableDirty();
    broadcastNotes();
    draw();
}

function deleteOpenNote() {
    if (!tableState.isDM || !openNoteId || !Array.isArray(tableState.notes)) return;

    tableState.notes = tableState.notes.filter(note => note.id !== openNoteId);
    closeNoteEditor(false);
    markTableDirty();
    broadcastNotes();
    draw();
}
