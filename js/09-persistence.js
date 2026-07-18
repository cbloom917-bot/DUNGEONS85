// Dungeons '85 Public Beta 9.7.3.4.12 — 09-persistence.js
// Ordered client module. Preserve script load order in index.html.

function sanitizeFilenamePart(value) {
    return String(value || 'DUNGEONS85')
        .replace(/[^a-z0-9_-]+/gi, '')
        .substring(0, 40) || 'DUNGEONS85';
}

function getExportTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function normalizeD85Filename(value, fallback) {
    const raw = String(value || '').trim();
    const baseName = raw || fallback;
    const safeName = baseName
        .replace(/\.d85$/i, '')
        .replace(/[^a-z0-9 _.-]+/gi, '')
        .trim()
        .substring(0, 80) || fallback;

    return `${safeName}.d85`;
}


function sanitizeImportedImageSource(src) {
    if (typeof src !== 'string') return null;
    if (src.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
    return src;
}

function sanitizeImportedToken(token) {
    if (!token || typeof token !== 'object') return null;

    const src = sanitizeImportedImageSource(token.src);
    if (!src) return null;

    return {
        id: String(token.id || `token-${Date.now()}-${Math.random()}`),
        src,
        x: Number(token.x) || 0,
        y: Number(token.y) || 0,
        size: Number(token.size) || DEFAULT_TOKEN_SIZE,
        hidden: Boolean(token.hidden),
        rev: Number(token.rev) || 0
    };
}

function sanitizeImportedNote(note) {
    if (!note || typeof note !== 'object') return null;

    return {
        id: String(note.id || `note-${Date.now()}-${Math.random()}`),
        x: Number(note.x) || 0,
        y: Number(note.y) || 0,
        label: String(note.label || '').substring(0, 40),
        body: String(note.body || '').substring(0, 1000)
    };
}

function sanitizeImportedSketch(sketch) {
    if (!sketch || typeof sketch !== 'object') return null;

    const type = String(sketch.type || '');
    if (!['line', 'circle', 'rect'].includes(type)) return null;

    const color = String(sketch.color || '#000000').toLowerCase();
    const allowedColors = new Set(['#000000', '#0066ff', '#ff3333', '#ffffff']);

    return {
        id: String(sketch.id || `sketch-${Date.now()}-${Math.random()}`),
        type,
        x1: Number(sketch.x1) || 0,
        y1: Number(sketch.y1) || 0,
        x2: Number(sketch.x2) || 0,
        y2: Number(sketch.y2) || 0,
        color: allowedColors.has(color) ? color : '#000000'
    };
}

function sanitizeImportedFoWPolygons(polygons) {
    if (!Array.isArray(polygons)) return [];

    return polygons
        .slice(0, MAX_FOW_POLYGONS)
        .map((polygon) => {
            if (!Array.isArray(polygon)) return null;

            const points = polygon
                .slice(0, MAX_FOW_POINTS_PER_POLYGON)
                .map((point) => {
                    if (!point || typeof point !== 'object') return null;

                    const x = Number(point.x);
                    const y = Number(point.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

                    return { x, y };
                })
                .filter(Boolean);

            return points.length >= 3 ? points : null;
        })
        .filter(Boolean);
}

function sanitizeImportedTableState(importedState) {
    const imported = importedState && typeof importedState === 'object' ? importedState : {};
    const mapSrc = sanitizeImportedImageSource(imported.mapSrc);

    return {
        ...imported,
        playerName: tableState.playerName,
        isDM: tableState.isDM,
        mapSrc: mapSrc || null,
        tokens: (Array.isArray(imported.tokens) ? imported.tokens : [])
            .map(sanitizeImportedToken)
            .filter(Boolean),
        notes: (Array.isArray(imported.notes) ? imported.notes : [])
            .map(sanitizeImportedNote)
            .filter(Boolean)
            .slice(0, 500),
        sketches: (Array.isArray(imported.sketches) ? imported.sketches : [])
            .map(sanitizeImportedSketch)
            .filter(Boolean)
            .slice(0, 500),
        fowEnabled: Boolean(imported.fowEnabled),
        fowPolygons: sanitizeImportedFoWPolygons(imported.fowPolygons),
        isDarknessActive: Boolean(imported.isDarknessActive)
    };
}

function exportTableState() {
    const stateString = JSON.stringify(tableState);
    const compressedData = pako.deflate(stateString);
    const blob = new Blob([compressedData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const roomName = sanitizeFilenamePart(activeRoomName || localStorage.getItem('d85LastRoomName') || 'DUNGEONS85');
    const defaultFilename = `${roomName}_${getExportTimestamp()}`;
    const requestedFilename = prompt('Save .d85 filename:', `${defaultFilename}.d85`);

    a.href = url;
    a.download = normalizeD85Filename(requestedFilename, defaultFilename);

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markTableSaved();
}

let d85ImportInProgress = false;

function createDungeonLoadId() {
    return `d85-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitDungeonLoadSignal(eventName, loadId) {
    if (!socket || !socket.connected || !loadId) return;
    socket.emit(eventName, { loadId });
}

async function importD85Module(file, inputElement = null) {
    // Capture the File object, then clear the browser input immediately. Browsers
    // otherwise suppress a second change event when the same physical file is
    // selected again during the same table session.
    if (inputElement) inputElement.value = '';
    if (!file) return;

    if (!tableState.isDM || !socketSeatConfirmed) {
        alert('The Dungeon Master seat must be confirmed before importing a .d85 file.');
        return;
    }

    if (d85ImportInProgress) {
        alert('A .d85 file is already loading.');
        return;
    }

    if (typeof isMapTransferBusy === 'function' && isMapTransferBusy()) {
        alert('A map is still being distributed. Please wait before loading another.');
        return;
    }

    const loadId = createDungeonLoadId();
    let loadSignalFinished = false;
    let localImportFinished = false;

    const finishLoadSignal = (eventName) => {
        if (loadSignalFinished) return;
        loadSignalFinished = true;
        emitDungeonLoadSignal(eventName, loadId);
    };

    const finishLocalImport = () => {
        if (localImportFinished) return false;
        localImportFinished = true;
        d85ImportInProgress = false;
        if (inputElement) inputElement.value = '';
        hideLoading();
        return true;
    };

    const failImport = (error) => {
        if (localImportFinished) return;
        debugError('D85 Import Error:', error);
        finishLoadSignal('dungeonLoadFailed');
        finishLocalImport();
        alert('Invalid .d85 file.');
    };

    d85ImportInProgress = true;
    showDungeonLoading();
    emitDungeonLoadSignal('dungeonLoadStarted', loadId);

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const decompressed = pako.inflate(
                new Uint8Array(e.target.result),
                { to: 'string' }
            );

            const previousTableState = tableState;
            tableState = sanitizeImportedTableState(JSON.parse(decompressed));
            if (tableState.isDM) updateFogUI();

            // Reserve the one-at-a-time map lane before publishing any imported
            // table state. If another transfer is active, restore the prior local
            // table and close the players' import overlays without partial sync.
            const broadcastResult = await broadcastFullTableState({
                reason: 'd85-import',
                loadId
            });
            if (!broadcastResult.ok) {
                tableState = previousTableState;
                if (tableState.isDM) updateFogUI();
                draw();
                finishLoadSignal('dungeonLoadFailed');
                finishLocalImport();
                return;
            }

            const uniqueImageSources = new Set();
            if (tableState.mapSrc) uniqueImageSources.add(tableState.mapSrc);
            tableState.tokens.forEach((token) => {
                if (token && token.src) uniqueImageSources.add(token.src);
            });

            const imageResults = await Promise.allSettled(
                [...uniqueImageSources].map((src) => loadCloudImage(src))
            );

            imageResults.forEach((result) => {
                if (result.status === 'rejected') {
                    debugWarn('DEBUG: Imported image source could not be decoded:', result.reason);
                }
            });

            await new Promise(resolve => requestAnimationFrame(resolve));

            if (tableState.mapSrc) centerMapInView();
            draw();

            markTableSaved();
            finishLoadSignal('dungeonLoadComplete');
            finishLocalImport();
            alert('.d85 File loaded successfully!');
        } catch (err) {
            failImport(err);
        }
    };

    reader.onerror = () => {
        failImport(new Error('Unable to read the selected file.'));
    };

    reader.onabort = () => {
        failImport(new Error('Reading the selected file was aborted.'));
    };

    try {
        reader.readAsArrayBuffer(file);
    } catch (err) {
        failImport(err);
    }
}

draw();
