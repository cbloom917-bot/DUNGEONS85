// Dungeons '85 Public Beta 9.6 — 09-persistence.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

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

function exportTableState() {
    const stateString = JSON.stringify(tableState);
    const compressedData = pako.deflate(stateString);
    const blob = new Blob([compressedData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const roomName = sanitizeFilenamePart(activeRoomName || localStorage.getItem('d85LastRoomName') || 'DUNGEONS85');
    a.href = url;
    a.download = `${roomName}[${getExportTimestamp()}].d85`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markTableSaved();
}

async function importD85Module(file) {
    if (!file) return;

    showDungeonLoading();

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const decompressed = pako.inflate(
                new Uint8Array(e.target.result),
                { to: 'string' }
            );

            tableState = JSON.parse(decompressed);
            if (!Array.isArray(tableState.notes)) tableState.notes = [];

            const imagePromises = [];

            if (tableState.mapSrc) {
                imagePromises.push(loadCloudImage(tableState.mapSrc));
            }

            if (Array.isArray(tableState.tokens)) {
                tableState.tokens.forEach(token => {
                    if (token.src) {
                        imagePromises.push(loadCloudImage(token.src));
                    }
                });
            }

            await Promise.all(imagePromises);
            await new Promise(resolve => requestAnimationFrame(resolve));

            broadcastFullTableState();

            draw();
            markTableSaved();

            alert(".d85 File loaded successfully!");
        } catch (err) {
            console.error("D85 Import Error:", err);
            alert("Invalid .d85 file.");
        } finally {
            hideLoading();
        }
    };

    reader.readAsArrayBuffer(file);
}

draw();
