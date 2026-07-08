const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const pkg = require('./package.json');

const app = express();
const server = http.createServer(app);

const MAX_IMAGE_DATA_URL_LENGTH = 12 * 1024 * 1024;
const MAX_SOCKET_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_FOW_POLYGONS = 500;
const MAX_FOW_POINTS_PER_POLYGON = 250;
const COMMUNITY_STATS_SAVE_DEBOUNCE_MS = 2000;
const RATE_LIMITS = Object.freeze({
    tokenMove: { windowMs: 1000, max: 30 },
    executeDiceRoll: { windowMs: 1000, max: 8 },
    updateMapImage: { windowMs: 10000, max: 3 },
    updateFoW: { windowMs: 1000, max: 12 }
});

const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ["https://dungeons85.com", "https://www.dungeons85.com"];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    transports: ['websocket'],
    pingInterval: 25000,
    pingTimeout: 60000 
});

app.get('/version', (req, res) => {
    res.json({ version: pkg.version });
});

const COMMUNITY_STATS_FILE = path.join(__dirname, 'community-stats.json');

function loadCommunityStats() {
    try {
        if (!fs.existsSync(COMMUNITY_STATS_FILE)) {
            return {
                playersSinceLaunch: 0,
                tablesSinceLaunch: 0
            };
        }

        const parsed = JSON.parse(fs.readFileSync(COMMUNITY_STATS_FILE, 'utf8'));
        return {
            playersSinceLaunch: Number(parsed.playersSinceLaunch) || 0,
            tablesSinceLaunch: Number(parsed.tablesSinceLaunch) || 0
        };
    } catch (err) {
        console.warn('[SYS] Could not load community stats:', err);
        return {
            playersSinceLaunch: 0,
            tablesSinceLaunch: 0
        };
    }
}

const communityStats = loadCommunityStats();
let communityStatsSaveTimer = null;

function flushCommunityStats() {
    communityStatsSaveTimer = null;
    fs.writeFile(COMMUNITY_STATS_FILE, JSON.stringify(communityStats, null, 2), (err) => {
        if (err) console.warn('[SYS] Could not save community stats:', err);
    });
}

function saveCommunityStats() {
    if (communityStatsSaveTimer) return;

    communityStatsSaveTimer = setTimeout(flushCommunityStats, COMMUNITY_STATS_SAVE_DEBOUNCE_MS);
    if (typeof communityStatsSaveTimer.unref === 'function') {
        communityStatsSaveTimer.unref();
    }
}

function getActiveCommunityStats() {
    const activeTables = Object.values(roomCampaignStates).filter(state => state && Array.isArray(state.players) && state.players.length > 0).length;
    const activePlayers = Object.values(roomCampaignStates).reduce((total, state) => {
        if (!state || !Array.isArray(state.players)) return total;
        return total + state.players.length;
    }, 0);

    return { activeTables, activePlayers };
}

function incrementCommunityStat(key) {
    communityStats[key] = (Number(communityStats[key]) || 0) + 1;
    saveCommunityStats();
}

function allowSocketEvent(socket, eventName) {
    const limit = RATE_LIMITS[eventName];
    if (!limit) return true;

    const now = Date.now();
    socket.data.rateLimits = socket.data.rateLimits || Object.create(null);

    const current = socket.data.rateLimits[eventName];
    if (!current || now - current.windowStart >= limit.windowMs) {
        socket.data.rateLimits[eventName] = { windowStart: now, count: 1 };
        return true;
    }

    current.count += 1;
    return current.count <= limit.max;
}

app.get('/community-stats', (req, res) => {
    res.json({
        ...communityStats,
        ...getActiveCommunityStats()
    });
});


app.use(express.static(__dirname));

const roomCampaignStates = {};

function sanitizeNote(note) {
    if (!note || typeof note !== 'object') return null;

    return {
        id: String(note.id || `note-${Date.now()}-${Math.random()}`),
        x: Number(note.x) || 0,
        y: Number(note.y) || 0,
        label: String(note.label || '').substring(0, 40),
        body: String(note.body || '').substring(0, 1000)
    };
}

function getPublicNotes(notes) {
    return (Array.isArray(notes) ? notes : [])
        .filter(note => note && String(note.label || '').trim())
        .map(note => ({
            id: String(note.id),
            x: Number(note.x) || 0,
            y: Number(note.y) || 0,
            label: String(note.label || '').substring(0, 40),
            body: ''
        }));
}


function sanitizeSketch(sketch) {
    if (!sketch || typeof sketch !== 'object') return null;

    const type = String(sketch.type || '');
    if (!['line', 'circle', 'rect'].includes(type)) return null;

    const color = String(sketch.color || '#000000');
    const allowedColors = new Set(['#000000', '#0066ff', '#ff3333', '#ffffff']);

    return {
        id: String(sketch.id || `sketch-${Date.now()}-${Math.random()}`),
        type,
        x1: Number(sketch.x1) || 0,
        y1: Number(sketch.y1) || 0,
        x2: Number(sketch.x2) || 0,
        y2: Number(sketch.y2) || 0,
        color: allowedColors.has(color.toLowerCase()) ? color.toLowerCase() : '#000000'
    };
}

function emitNotesToRoom(roomName, sourceSocketId = null) {
    const state = roomCampaignStates[roomName];
    if (!state) return;

    state.players.forEach(player => {
        // The GM already owns the authoritative local notes state after editing.
        // Echoing syncNotes back to the editing socket can create an update loop.
        if (sourceSocketId && player.socketId === sourceSocketId) return;

        const payload = player.isDM ? state.notes : getPublicNotes(state.notes);
        io.to(player.socketId).emit('syncNotes', payload);
    });
}


function sanitizeImageSource(src) {
    const value = String(src || '');
    if (value.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
    return value;
}

function isImageSourceWithinLimit(src) {
    return typeof src === 'string' && src.length <= MAX_IMAGE_DATA_URL_LENGTH;
}

function sanitizeFoWPolygons(polygons) {
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

function sanitizeToken(token) {
    if (!token || typeof token !== 'object') return null;

    const src = sanitizeImageSource(token.src);
    if (src === null) return null;

    return {
        id: String(token.id || `token-${Date.now()}-${Math.random()}`),
        src,
        x: Number(token.x) || 0,
        y: Number(token.y) || 0,
        size: Number(token.size) || 70,
        hidden: Boolean(token.hidden),
        rev: Number(token.rev) || 0
    };
}

function bumpTokenRevision(token) {
    token.rev = (Number(token.rev) || 0) + 1;
    return token.rev;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (data) => {
        if (!data || typeof data !== 'object') return;
        
        let { roomName, playerName, isDM, peerId } = data;

        if (typeof roomName !== 'string' || typeof playerName !== 'string') {
            socket.emit('joinError', 'Invalid room or player name format.');
            return;
        }

        currentRoom = roomName.substring(0, 50).toUpperCase();
        playerName = playerName.substring(0, 50);
        isDM = Boolean(isDM);
        
        const roomAlreadyExisted = Boolean(roomCampaignStates[currentRoom]);

        if (!roomCampaignStates[currentRoom]) {
            if (!isDM) {
                socket.emit('joinError', 'That room does not exist. Please check the name or wait for the DM to start the table.');
                return; 
            }
            roomCampaignStates[currentRoom] = { 
                mapSrc: null, 
                tokens: [], 
                players: [], 
                wipeTimer: null, 
                fowEnabled: false, 
                fowPolygons: [],
                isDarknessActive: false,
                notes: [],
                sketches: [],
                initiativePeerId: null,
                videoOrder: []
            };
            incrementCommunityStat('tablesSinceLaunch');
        }

        socket.join(currentRoom);
        const state = roomCampaignStates[currentRoom];

        if (isDM) {
            const existingDM = state.players.find(p => p.isDM === true);
            if (existingDM && existingDM.socketId !== socket.id) {
                socket.emit('joinError', 'This table already has a GM. Please join as a player.');
                return; 
            }
        }

        state.players = state.players.filter(p => p.socketId !== socket.id);
        state.players.push({
            socketId: socket.id,
            peerId: String(peerId),
            name: playerName,
            isDM,
            micEnabled: false,
            camEnabled: false
        });
        incrementCommunityStat('playersSinceLaunch');

        if (state.wipeTimer) {
            clearTimeout(state.wipeTimer);
            state.wipeTimer = null;
        }

        // Send fog before map/tokens so joining players never render a covered
        // dungeon uncovered for a frame while the Fog of War state catches up.
        socket.emit('syncFoW', { 
            enabled: state.fowEnabled, 
            polygons: state.fowPolygons, 
            darkness: state.isDarknessActive 
        });
        if (state.mapSrc) socket.emit('syncMap', state.mapSrc);
        socket.emit('syncTokens', state.tokens); 
        socket.emit('syncNotes', isDM ? state.notes : getPublicNotes(state.notes));
        socket.emit('syncSketches', state.sketches || []);

        socket.emit('syncInitiativeSpotlight', state.initiativePeerId || null);
        socket.emit('syncVideoOrder', state.videoOrder || []);
        
        io.to(currentRoom).emit('updatePlayerList', state.players);

        // Only announce meaningful table-entry events.
        // A GM websocket reconnect should be silent; otherwise brief transport
        // closes spam the table log and look like new table creation.
        if (isDM && !roomAlreadyExisted) {
            io.to(currentRoom).emit('playerNotification', `${playerName} HAS CREATED THE TABLE`);
        } else if (!isDM) {
            io.to(currentRoom).emit('playerNotification', `${playerName} HAS JOINED THE TABLE`);
        }
    });


    socket.on('updateMediaState', (mediaState) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!mediaState || typeof mediaState !== 'object') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const nextMicEnabled = Boolean(mediaState.micEnabled);
        const nextCamEnabled = Boolean(mediaState.camEnabled);

        if (player.micEnabled === nextMicEnabled && player.camEnabled === nextCamEnabled) return;

        player.micEnabled = nextMicEnabled;
        player.camEnabled = nextCamEnabled;

        io.to(currentRoom).emit('updatePlayerList', state.players);
    });

    socket.on('updateTokensMatrix', (tokens) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!Array.isArray(tokens)) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);

        // Only the GM can replace the full token list.
        // This prevents a reconnecting/stale player client from resurrecting old token state.
        if (!player || !player.isDM) return;

        const leanTokens = tokens
            .map(sanitizeToken)
            .filter(Boolean)
            .map((token) => {
                bumpTokenRevision(token);
                return token;
            });

        state.tokens = leanTokens;
        socket.broadcast.to(currentRoom).emit('syncTokens', leanTokens);
    });

    socket.on('tokenMove', (data) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!data || typeof data !== 'object') return;
        if (!allowSocketEvent(socket, 'tokenMove')) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const token = state.tokens.find(t => String(t.id) === String(data.id));
        if (!token) return;

        // Players may move visible table tokens. Hidden tokens remain GM-only.
        if (!player.isDM && token.hidden) return;

        const nextX = Number(data.x);
        const nextY = Number(data.y);
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;

        token.x = nextX;
        token.y = nextY;
        const rev = bumpTokenRevision(token);

        socket.to(currentRoom).emit('tokenMoved', {
            id: token.id,
            x: token.x,
            y: token.y,
            rev
        });
    });

    socket.on('tokenResize', (data) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!data || typeof data !== 'object') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        const token = state.tokens.find(t => String(t.id) === String(data.id));
        if (!token) return;

        const nextSize = Number(data.size);
        if (!Number.isFinite(nextSize) || nextSize <= 0) return;

        token.size = nextSize;
        const rev = bumpTokenRevision(token);

        socket.to(currentRoom).emit('tokenResized', {
            id: token.id,
            size: token.size,
            rev
        });
    });

    socket.on('tokenVisibility', (data) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!data || typeof data !== 'object') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        const token = state.tokens.find(t => String(t.id) === String(data.id));
        if (!token) return;

        token.hidden = Boolean(data.hidden);
        const rev = bumpTokenRevision(token);

        socket.to(currentRoom).emit('tokenVisibilityChanged', {
            id: token.id,
            hidden: token.hidden,
            rev
        });
    });

    socket.on('tokenAdd', (incomingToken) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        const token = sanitizeToken(incomingToken);
        if (!token || !token.src) return;

        bumpTokenRevision(token);
        state.tokens.push(token);
        socket.to(currentRoom).emit('tokenAdded', token);
    });

    socket.on('tokenDelete', (data) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!data || typeof data !== 'object') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        const tokenId = String(data.id || '');
        if (!tokenId) return;

        const beforeCount = state.tokens.length;
        state.tokens = state.tokens.filter(t => String(t.id) !== tokenId);
        if (state.tokens.length !== beforeCount) {
            socket.to(currentRoom).emit('tokenDeleted', { id: tokenId });
        }
    });

    socket.on('updateMapImage', (mapSrcString) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (typeof mapSrcString !== 'string') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;
        if (!allowSocketEvent(socket, 'updateMapImage')) return;
        if (!isImageSourceWithinLimit(mapSrcString)) return;
        
        state.mapSrc = mapSrcString;

        if (state.fowEnabled || state.isDarknessActive || (Array.isArray(state.fowPolygons) && state.fowPolygons.length > 0)) {
            socket.to(currentRoom).emit('syncFoW', {
                enabled: state.fowEnabled,
                polygons: state.fowPolygons,
                darkness: state.isDarknessActive
            });
        }

        socket.to(currentRoom).emit('syncMap', mapSrcString);
    });

    socket.on('updateNotes', (notes) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!Array.isArray(notes)) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);

        // Only the GM can create, edit, delete, or broadcast private map notes.
        if (!player || !player.isDM) return;

        state.notes = notes
            .map(sanitizeNote)
            .filter(Boolean)
            .slice(0, 500);

        emitNotesToRoom(currentRoom, socket.id);
    });


    socket.on('updateSketches', (sketches) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!Array.isArray(sketches)) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);

        // Only the GM can create, erase, or broadcast map sketches.
        if (!player || !player.isDM) return;

        state.sketches = sketches
            .map(sanitizeSketch)
            .filter(Boolean)
            .slice(0, 500);

        socket.broadcast.to(currentRoom).emit('syncSketches', state.sketches);
    });

    socket.on('executeDiceRoll', (rollData) => {
        if (!currentRoom || !rollData || typeof rollData !== 'object') return;
        if (!allowSocketEvent(socket, 'executeDiceRoll')) return;
        io.to(currentRoom).emit('diceRolledAnimation', rollData);
    });

    socket.on('forceCamera', (cameraData) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!cameraData || typeof cameraData !== 'object') return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        socket.to(currentRoom).emit('syncCamera', cameraData);
    });

    // Fog of war and darkness state sync.
    socket.on('updateFoW', (fowData) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!fowData || typeof fowData !== 'object') return;
        if (!allowSocketEvent(socket, 'updateFoW')) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        state.fowEnabled = Boolean(fowData.enabled);
        
        if (Array.isArray(fowData.polygons)) {
            state.fowPolygons = sanitizeFoWPolygons(fowData.polygons);
        }
        
        if (fowData.darkness !== undefined) {
            state.isDarknessActive = Boolean(fowData.darkness);
        }

        socket.broadcast.to(currentRoom).emit('syncFoW', {
            enabled: state.fowEnabled,
            polygons: state.fowPolygons,
            darkness: state.isDarknessActive
        });
    });


    socket.on('setInitiativeSpotlight', (peerId) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        state.initiativePeerId = peerId ? String(peerId) : null;

        io.to(currentRoom).emit('syncInitiativeSpotlight', state.initiativePeerId);
    });


    socket.on('setVideoOrder', (peerOrder) => {
        if (!currentRoom || !roomCampaignStates[currentRoom]) return;
        if (!Array.isArray(peerOrder)) return;

        const state = roomCampaignStates[currentRoom];
        const player = state.players.find(p => p.socketId === socket.id);
        if (!player || !player.isDM) return;

        const activePeerIds = new Set(state.players.map(p => String(p.peerId)));

        // Store the full seating order, including the DM.
        // This lets the DM place themselves anywhere in the clockwise initiative order.
        state.videoOrder = peerOrder
            .map(peerId => String(peerId))
            .filter(peerId => activePeerIds.has(peerId));

        io.to(currentRoom).emit('syncVideoOrder', state.videoOrder);
    });

    socket.on('disconnect', () => {
        if (currentRoom && roomCampaignStates[currentRoom]) {
            const state = roomCampaignStates[currentRoom];
            const departingPlayer = state.players.find(p => p.socketId === socket.id);
            state.players = state.players.filter(p => p.socketId !== socket.id);

            const remainingPeerIds = new Set(state.players.map(p => String(p.peerId)));
            state.videoOrder = (state.videoOrder || []).filter(peerId => remainingPeerIds.has(String(peerId)));

            if (departingPlayer && state.initiativePeerId === String(departingPlayer.peerId)) {
                state.initiativePeerId = null;
                io.to(currentRoom).emit('syncInitiativeSpotlight', null);
            }
            
            if (state.players.length === 0) {
                state.wipeTimer = setTimeout(() => {
                    if (roomCampaignStates[currentRoom] && roomCampaignStates[currentRoom].players.length === 0) {
                        delete roomCampaignStates[currentRoom];
                        console.log(`[SYS] Room ${currentRoom} wiped after 20 minutes of inactivity.`);
                    }
                }, 1200000); // 20 minutes
            } else {
                io.to(currentRoom).emit('updatePlayerList', state.players);
                io.to(currentRoom).emit('syncVideoOrder', state.videoOrder || []);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Dungeons '85 Server Running on port ${PORT}]`);
});
