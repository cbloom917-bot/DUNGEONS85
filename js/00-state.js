// Dungeons '85 Public Beta 9.6 — 00-state.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Dungeons '85 — Client Runtime
// Version 9.0 Public Beta cleanup pass
// ============================================================

const SERVER_URL = "https://newvtt.onrender.com";
const DEFAULT_TOKEN_SIZE = 70;
const GRID_SIZE = 70;
const DEFAULT_MAP_ZOOM = 0.5;
const MAX_IMAGE_DATA_URL_LENGTH = 12 * 1024 * 1024;
const MAX_FOW_POLYGONS = 500;
const MAX_FOW_POINTS_PER_POLYGON = 250;
const D85_DEBUG_LOGS = false;

function debugLog(...args) {
    if (D85_DEBUG_LOGS) console.log(...args);
}

function debugWarn(...args) {
    if (D85_DEBUG_LOGS) console.warn(...args);
}

function debugError(...args) {
    if (D85_DEBUG_LOGS) console.error(...args);
}

function debugCount(...args) {
    if (D85_DEBUG_LOGS) console.count(...args);
}

let tableState = {
    playerName: '',
    isDM: false,
    mapSrc: null,
    tokens: [],
    notes: [],
    sketches: [],
    camera: { x: 0, y: 0, zoom: 1 },
    fowEnabled: false,
    fowPolygons: [],
    isDarknessActive: false
};

let tokenImageCache = {};
let socket = null;
let peer = null;
let localStream = null;
let activePeerCalls = new Map();
let currentActiveRoomArray = [];
let localPeerId = null;
let activeRoomName = '';
let initiativePeerId = null;
let customVideoOrder = [];
let tableOrder = []; // Saved exploration/marching order restored when combat initiative ends.

let isDrawingFoW = false;
let currentFoWPolygon = [];
let currentMouseWorldX = 0;
let currentMouseWorldY = 0;
let contextSelectedToken = null;
let gmRoomMode = "create";
let hasReceivedInitialTokenSync = false;
let hasReceivedInitialFoWSync = false;
let hasReceivedInitialMapSync = false;
let hasReceivedInitialNotesSync = false;
let hasReceivedInitialSketchSync = false;
let notesVisible = false;
let openNoteId = null;
let pendingNoteWorldPosition = null;
let tableDirty = false;

let activeSketchTool = null;
let sketchDraft = null;
const SKETCH_COLORS = [
    { name: 'black', value: '#000000' },
    { name: 'blue', value: '#0066ff' },
    { name: 'red', value: '#ff3333' },
    { name: 'white', value: '#ffffff' }
];
let sketchToolColors = {
    line: 0,
    circle: 0,
    rect: 0
};

const TOKEN_MOVE_EMIT_INTERVAL_MS = 75;
const VIDEO_CAPTURE_CONSTRAINTS = {
    width: { ideal: 640, max: 854 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 15, max: 20 }
};

const AUDIO_CAPTURE_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
};

const VIDEO_SENDER_MAX_BITRATE_BPS = 450000;
let lastTokenMoveEmitAt = 0;
let pendingTokenMove = null;
let pendingTokenMoveTimer = null;

function markTableDirty() {
    if (!tableState.isDM) return;
    tableDirty = true;
}

function markTableSaved() {
    tableDirty = false;
}

function hasUnsavedTableChanges() {
    return !!(tableState.isDM && tableDirty);
}

window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedTableChanges()) return;

    // Modern browsers ignore custom text, but setting returnValue to a
    // non-empty string is still the most compatible way to trigger the
    // native unsaved-changes confirmation dialog.
    event.preventDefault();
    event.returnValue = 'You have unsaved changes.';
    return event.returnValue;
});

const canvas = document.getElementById('vtt-canvas');
const ctx = canvas.getContext('2d');
const ctxMenu = document.getElementById('ctx-menu');
const fogCanvas = document.createElement('canvas');
const fogCtx = fogCanvas.getContext('2d');

const adjectives = [
    "Bitter", "Black", "Bleak", "Broken", "Cold",
    "Crimson", "Crooked", "Cursed", "Dark", "Death",
    "Deep", "Fallen", "Forgotten", "Frozen", "Golden",
    "Hollow", "Iron", "Lost", "Shattered", "Silent",
    "Storm", "Sunken", "Thorn", "Ancient", "Ashen",
    "Bloodied", "Charnel", "Doomed", "Drowned", "Ebon",
    "Gilded", "Grave", "Grim", "Haunted", "Moonless",
    "Ravenous", "Ruined", "Rusted", "Sable", "Shadowed",
    "Sinister", "Stygian", "Tainted", "Umbral", "Unhallowed",
    "Vermin", "Withered", "Wretched", "Ghastly", "Nameless"
];
const nouns = [
    "Abyss", "Barrow", "Bastion", "Bloom", "Bog",
    "Cairn", "Cavern", "Crawl", "Crypt", "Fen",
    "Forest", "Fortress", "Keep", "Marsh", "Mire",
    "Moor", "Pit", "Shrine", "Spawn", "Temple",
    "Tower", "Vale", "Vault", "Void", "Warren",
    "Catacomb", "Chasm", "Citadel", "Coffin", "Crypts",
    "Dolmen", "Dungeon", "Gaol", "Grave", "Grove",
    "Gulch", "Halls", "Labyrinth", "Monolith", "Necropolis",
    "Obelisk", "Ossuary", "Palisade", "Ruin", "Sanctum",
    "Sepulcher", "Spire", "Tomb", "Undercrypt", "Ziggurat"
];

