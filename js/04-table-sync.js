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
    }

function toggleFogMode() {
        if (!tableState.isDM) return;
        tableState.fowEnabled = !tableState.fowEnabled;
        if (!tableState.fowEnabled) {
            isDrawingFoW = false; 
            currentFoWPolygon = [];
        }
        updateFogUI();
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





