// Dungeons '85 Public Beta 9.6 — 04-table-sync.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

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
function broadcastFullTableState() {
        if (!tableState.isDM || !socket) return;

        if (tableState.mapSrc) {
        socket.emit('updateMapImage', tableState.mapSrc);
        }

        broadcastTokensMatrixChange();
        broadcastFoW();
        broadcastNotes();
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


function broadcastTokensMatrixChange() {
        if (!tableState.isDM || !socket) return;
        const leanTokens = tableState.tokens.map(t => ({
            id: t.id,
            src: t.src, 
            x: t.x,
            y: t.y,
            size: t.size,
            hidden: t.hidden
        }));
        socket.emit('updateTokensMatrix', leanTokens);
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

    btn.innerText = notesVisible ? 'HIDE NOTES' : 'SHOW NOTES';

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
