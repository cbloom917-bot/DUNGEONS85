// Dungeons '85 Public Beta 9.6 — 01-assets.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Loading overlay and asset loading
// ============================================================

function showLoading(msg = "RECONSTRUCTING DUNGEON...") {
    document.getElementById('loading-msg').innerText = msg;
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

async function loadCloudImage(src) {
    if (!src) return null;
    if (tokenImageCache[src] && tokenImageCache[src].complete) return tokenImageCache[src];

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            tokenImageCache[src] = img;
            resolve(img);
        };
        img.onerror = () => reject(new Error(`Image failed to load: ${src}`));
        img.src = src;
    });
}

function selectLocalFile(mode) {
    if (!tableState.isDM) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showLoading("PROCESSING ASSET...");

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;

            if (mode === 'MAP') {
                tableState.mapSrc = dataUrl;
                if (socket) socket.emit('updateMapImage', dataUrl);
            } else {
                tableState.tokens.push({
                    id: `token-${Date.now()}`,
                    src: dataUrl,
                    x: (canvas.width / 2 - tableState.camera.x) / tableState.camera.zoom,
                    y: (canvas.height / 2 - tableState.camera.y) / tableState.camera.zoom,
                    size: DEFAULT_TOKEN_SIZE,
                    hidden: true
                });
                broadcastTokensMatrixChange();
            }

            loadCloudImage(dataUrl).then(() => {
                hideLoading();
                draw();
            }).catch((err) => {
                console.error(err);
                hideLoading();
            });
        };

        reader.readAsDataURL(file);
    };

    input.click();
}

