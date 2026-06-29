// Dungeons '85 Public Beta 9.6 — 00-state.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Dungeons '85 — Client Runtime
// Version 9.0 Public Beta cleanup pass
// ============================================================

const SERVER_URL = "https://newvtt.onrender.com";
const DEFAULT_TOKEN_SIZE = 70;
const GRID_SIZE = 70;

let tableState = {
    playerName: '',
    isDM: false,
    mapSrc: null,
    tokens: [],
    notes: [],
    camera: { x: 0, y: 0, zoom: 1 },
    fowEnabled: false,
    fowPolygons: [],
    isDarknessActive: false
};

let tokenImageCache = {};
let socket = null;
let peer = null;
let localStream = null;
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
let notesVisible = false;
let openNoteId = null;
let pendingNoteWorldPosition = null;
let tableDirty = false;

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

const adjectives = ["Dark", "Iron", "Black", "Silent", "Bitter", "Deep", "Lost", "Fallen", "Death", "Broken"];
const nouns = ["Crypt", "Spawn", "Vault", "Temple", "Bloom", "Pit", "Crawl", "Keep", "Void", "Abyss"];

