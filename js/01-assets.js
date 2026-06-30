// Dungeons '85 Public Beta 9.6 — 01-assets.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Loading overlay and asset loading
// ============================================================

const DUNGEON_LOADING_MESSAGES = [
    "LOADING DUNGEON...",
    "BUILDING WALLS...",
    "SETTING TRAPS...",
    "RELEASING MONSTERS...",
    "POLISHING TREASURE...",
    "FINISHING TOUCHES..."
];

let dungeonLoadingMessageTimer = null;
let dungeonLoadingMessageIndex = 0;

function setLoadingMessage(msg) {
    const loadingMsg = document.getElementById('loading-msg');
    if (loadingMsg) loadingMsg.innerText = msg;
}

function stopDungeonLoadingMessages() {
    if (dungeonLoadingMessageTimer) {
        clearInterval(dungeonLoadingMessageTimer);
        dungeonLoadingMessageTimer = null;
    }
}

function startDungeonLoadingMessages() {
    stopDungeonLoadingMessages();
    dungeonLoadingMessageIndex = 0;
    setLoadingMessage(DUNGEON_LOADING_MESSAGES[dungeonLoadingMessageIndex]);

    dungeonLoadingMessageTimer = setInterval(() => {
        dungeonLoadingMessageIndex = (dungeonLoadingMessageIndex + 1) % DUNGEON_LOADING_MESSAGES.length;
        setLoadingMessage(DUNGEON_LOADING_MESSAGES[dungeonLoadingMessageIndex]);
    }, 450);
}

function showLoading(msg = "RECONSTRUCTING DUNGEON...", rotateDungeonMessages = false) {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (!loadingOverlay) return;

    if (rotateDungeonMessages) {
        startDungeonLoadingMessages();
    } else {
        stopDungeonLoadingMessages();
        setLoadingMessage(msg);
    }

    loadingOverlay.style.display = 'flex';
}

function showDungeonLoading() {
    showLoading("LOADING DUNGEON...", true);
}

function hideLoading() {
    stopDungeonLoadingMessages();

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';
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
                markTableDirty();
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
                markTableDirty();
                emitTokenAdd(tableState.tokens[tableState.tokens.length - 1]);
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

