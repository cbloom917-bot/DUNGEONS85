// Dungeons '85 Public Beta 9.7.3.4.12 — 01-assets.js
// Ordered client module. Preserve script load order in index.html.

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
const imageLoadPromises = new Map();

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

function describeImageSource(src) {
    const value = String(src || '');
    if (!value) return '[empty image source]';

    if (value.startsWith('data:')) {
        const commaIndex = value.indexOf(',');
        const prefixEnd = commaIndex >= 0 ? Math.min(commaIndex + 1, 80) : 80;
        return `${value.slice(0, prefixEnd)}… (${value.length} characters)`;
    }

    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

async function loadCloudImage(src) {
    if (!src) return null;

    const cachedImage = tokenImageCache[src];
    if (cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
        return cachedImage;
    }

    const existingLoad = imageLoadPromises.get(src);
    if (existingLoad) return existingLoad;

    const loadPromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            tokenImageCache[src] = img;
            resolve(img);
        };
        img.onerror = () => reject(new Error(`Image failed to load: ${describeImageSource(src)}`));
        img.src = src;
    });

    imageLoadPromises.set(src, loadPromise);

    try {
        return await loadPromise;
    } finally {
        if (imageLoadPromises.get(src) === loadPromise) {
            imageLoadPromises.delete(src);
        }
    }
}

function selectLocalFile(mode, spawnPoint = null) {
    if (!tableState.isDM) return;

    if (mode === 'MAP' && typeof isMapTransferBusy === 'function' && isMapTransferBusy()) {
        alert('A map is still being distributed. Please wait before loading another.');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showLoading("PROCESSING ASSET...");

        const reader = new FileReader();
        reader.onload = async (event) => {
            const dataUrl = event.target.result;

            if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
                hideLoading();
                alert(`${mode === 'MAP' ? 'Map' : 'Token'} image exceeds maximum supported size.`);
                return;
            }

            if (mode === 'MAP') {
                const mapResult = await sendMapUpdateWithBackpressure(dataUrl, {
                    reason: 'direct-map-load'
                });
                if (!mapResult.ok) {
                    hideLoading();
                    return;
                }

                tableState.mapSrc = dataUrl;
                markTableDirty();
            } else {
                const tokenX = spawnPoint && Number.isFinite(Number(spawnPoint.x))
                    ? Number(spawnPoint.x)
                    : (canvas.width / 2 - tableState.camera.x) / tableState.camera.zoom;
                const tokenY = spawnPoint && Number.isFinite(Number(spawnPoint.y))
                    ? Number(spawnPoint.y)
                    : (canvas.height / 2 - tableState.camera.y) / tableState.camera.zoom;
                tableState.tokens.push({
                    id: `token-${Date.now()}`,
                    src: dataUrl,
                    x: tokenX,
                    y: tokenY,
                    size: DEFAULT_TOKEN_SIZE,
                    hidden: true
                });
                markTableDirty();
                emitTokenAdd(tableState.tokens[tableState.tokens.length - 1]);
            }

            loadCloudImage(dataUrl).then(() => {
                if (mode === 'MAP') centerMapInView();
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

