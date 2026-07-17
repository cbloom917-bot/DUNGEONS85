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

function replacePeerIdInRoomState(state, oldPeerId, newPeerId) {
    if (!state) return;

    const oldKey = String(oldPeerId || '');
    const newKey = String(newPeerId || '');
    if (!oldKey || !newKey || oldKey === newKey) return;

    const participant = Array.isArray(state.players)
        ? state.players.find(player => String(player.peerId) === oldKey)
        : null;
    if (participant) participant.peerId = newKey;

    const seen = new Set();
    state.videoOrder = (Array.isArray(state.videoOrder) ? state.videoOrder : [])
        .map(peerId => String(peerId) === oldKey ? newKey : String(peerId))
        .filter(peerId => {
            if (!peerId || seen.has(peerId)) return false;
            seen.add(peerId);
            return true;
        });

    if (String(state.initiativePeerId || '') === oldKey) {
        state.initiativePeerId = newKey;
    }
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (data, acknowledge) => {
        let joinResponseSent = false;

        const respond = (payload) => {
            if (joinResponseSent) return;
            joinResponseSent = true;
            if (typeof acknowledge === 'function') acknowledge(payload);
        };

        const rejectJoin = (code, message) => {
            const payload = { ok: false, code, message };
            socket.emit('joinError', payload);
            respond(payload);
        };

        if (!data || typeof data !== 'object') {
            rejectJoin('INVALID_JOIN_PAYLOAD', 'Invalid room, player name, or peer identity format.');
            return;
        }

        let { roomName, playerName, isDM, peerId } = data;

        if (
            typeof roomName !== 'string' ||
            typeof playerName !== 'string' ||
            typeof peerId !== 'string' ||
            !peerId.trim()
        ) {
            rejectJoin('INVALID_JOIN_PAYLOAD', 'Invalid room, player name, or peer identity format.');
            return;
        }

        const requestedRoom = roomName.substring(0, 50).toUpperCase();
        playerName = playerName.substring(0, 50);
        peerId = peerId.trim();
        isDM = Boolean(isDM);

        const roomAlreadyExisted = Boolean(roomCampaignStates[requestedRoom]);

        if (!roomCampaignStates[requestedRoom]) {
            if (!isDM) {
                rejectJoin(
                    'ROOM_NOT_FOUND',
                    'That room does not exist. Please check the name or wait for the DM to start the table.'
                );
                return;
            }
            roomCampaignStates[requestedRoom] = {
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

        const emitDmSeatConflict = () => {
            rejectJoin(
                'DM_SEAT_CONFLICT',
                'This table already has a Dungeon Master. Please join as a player.'
            );
        };

        const admitSocket = (displacedDM = null) => {
            const state = roomCampaignStates[requestedRoom];
            if (!state) {
                rejectJoin('ROOM_UNAVAILABLE', 'The table became unavailable while reconnecting. Please try again.');
                return;
            }

            const displacedPeerId = displacedDM ? String(displacedDM.peerId || '') : '';

            const samePeerPlayers = state.players.filter(player => String(player.peerId) === peerId);
            const existingPeerPlayer = samePeerPlayers.find(player => player.isDM === true) || samePeerPlayers[0] || null;
            const preservedSeat = existingPeerPlayer || displacedDM;
            const effectiveIsDM = existingPeerPlayer
                ? Boolean(existingPeerPlayer.isDM)
                : (displacedDM ? true : isDM);

            if (displacedDM) {
                replacePeerIdInRoomState(state, displacedDM.peerId, peerId);

                const staleDmSocket = io.sockets.sockets.get(displacedDM.socketId);
                if (staleDmSocket && staleDmSocket.id !== socket.id) {
                    staleDmSocket.data.skipRoomCleanupForSeatReclaim = true;
                    staleDmSocket.disconnect(true);
                }

                state.players = state.players.filter(player => player.socketId !== displacedDM.socketId);
            }

            const isSeatReclaim = Boolean(displacedDM) || samePeerPlayers.some(player => player.socketId !== socket.id);

            samePeerPlayers.forEach((stalePlayer) => {
                if (stalePlayer.socketId === socket.id) return;

                const staleSocket = io.sockets.sockets.get(stalePlayer.socketId);
                if (staleSocket) {
                    staleSocket.data.skipRoomCleanupForSeatReclaim = true;
                    staleSocket.disconnect(true);
                }
            });

            state.players = state.players.filter(player => String(player.peerId) !== peerId);

            socket.join(requestedRoom);
            currentRoom = requestedRoom;

            const joinedPlayer = {
                socketId: socket.id,
                peerId,
                name: preservedSeat ? preservedSeat.name : playerName,
                isDM: effectiveIsDM,
                micEnabled: preservedSeat ? Boolean(preservedSeat.micEnabled) : false,
                camEnabled: preservedSeat ? Boolean(preservedSeat.camEnabled) : false
            };
            state.players.push(joinedPlayer);

            if (!preservedSeat) incrementCommunityStat('playersSinceLaunch');

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
            socket.emit('syncNotes', joinedPlayer.isDM ? state.notes : getPublicNotes(state.notes));
            socket.emit('syncSketches', state.sketches || []);
            socket.emit('syncInitiativeSpotlight', state.initiativePeerId || null);
            socket.emit('syncVideoOrder', state.videoOrder || []);

            if (displacedDM && displacedPeerId && displacedPeerId !== peerId) {
                io.to(currentRoom).emit('peerIdentityReplaced', {
                    oldPeerId: displacedPeerId,
                    newPeerId: peerId
                });
            }

            io.to(currentRoom).emit('updatePlayerList', state.players);
            io.to(currentRoom).emit('syncVideoOrder', state.videoOrder || []);
            if (displacedDM && state.initiativePeerId) {
                io.to(currentRoom).emit('syncInitiativeSpotlight', state.initiativePeerId);
            }

            if (joinedPlayer.isDM && !roomAlreadyExisted) {
                io.to(currentRoom).emit('playerNotification', `${joinedPlayer.name} HAS CREATED THE TABLE`);
            } else if (!joinedPlayer.isDM && !isSeatReclaim) {
                io.to(currentRoom).emit('playerNotification', `${joinedPlayer.name} HAS JOINED THE TABLE`);
            }

            respond({
                ok: true,
                roomName: requestedRoom,
                peerId: joinedPlayer.peerId,
                socketId: socket.id,
                reclaimed: Boolean(preservedSeat),
                isDM: joinedPlayer.isDM
            });
        };

        const state = roomCampaignStates[requestedRoom];
        const samePeerPlayer = state.players.find(player => String(player.peerId) === peerId) || null;
        const effectiveIsDM = samePeerPlayer ? Boolean(samePeerPlayer.isDM) : isDM;

        if (!effectiveIsDM) {
            admitSocket();
            return;
        }

        const existingDM = state.players.find(player => player.isDM === true && String(player.peerId) !== peerId);
        if (!existingDM) {
            admitSocket();
            return;
        }

        const occupyingDmSocket = io.sockets.sockets.get(existingDM.socketId);
        if (!occupyingDmSocket || !occupyingDmSocket.connected) {
            admitSocket(existingDM);
            return;
        }

        // A sleeping/zombie socket can remain in Socket.IO's registry until its
        // ping timeout expires. Probe the browser before treating the seat as live.
        occupyingDmSocket.timeout(2000).emit('seatProbe', (err) => {
            const currentState = roomCampaignStates[requestedRoom];
            if (!currentState) {
                rejectJoin('ROOM_UNAVAILABLE', 'The table became unavailable while checking the DM seat.');
                return;
            }

            const currentDM = currentState.players.find(player => player.isDM === true && String(player.peerId) !== peerId);
            if (!currentDM) {
                admitSocket();
                return;
            }

            if (currentDM.socketId !== existingDM.socketId) {
                emitDmSeatConflict();
                return;
            }

            if (err) {
                admitSocket(currentDM);
                return;
            }

            emitDmSeatConflict();
        });
    });

    socket.on('replacePeerIdentity', (identity, acknowledge) => {
        const respond = (payload) => {
            if (typeof acknowledge === 'function') acknowledge(payload);
        };

        const rejectIdentity = (code, message) => {
            const payload = { ok: false, code, message };
            socket.emit('identityError', payload);
            respond(payload);
        };

        if (!currentRoom || !roomCampaignStates[currentRoom]) {
            rejectIdentity('NO_ACTIVE_ROOM', 'Media identity migration failed because the table seat is unavailable.');
            return;
        }

        if (!identity || typeof identity !== 'object') {
            rejectIdentity('BAD_IDENTITY_PAYLOAD', 'Media identity migration received an invalid payload.');
            return;
        }

        const oldPeerId = typeof identity.oldPeerId === 'string' ? identity.oldPeerId.trim() : '';
        const newPeerId = typeof identity.newPeerId === 'string' ? identity.newPeerId.trim() : '';
        if (!oldPeerId || !newPeerId || oldPeerId === newPeerId) {
            rejectIdentity('BAD_IDENTITY_PAYLOAD', 'Media identity migration requires distinct peer identities.');
            return;
        }

        const state = roomCampaignStates[currentRoom];
        const participant = state.players.find(player => player.socketId === socket.id);
        if (!participant || String(participant.peerId) !== oldPeerId) {
            rejectIdentity('NOT_SEAT_OWNER', 'Media identity migration was rejected because this socket does not own the seat.');
            return;
        }

        if (state.players.some(player => String(player.peerId) === newPeerId)) {
            rejectIdentity('ID_IN_USE', 'Media identity migration was rejected because the replacement identity is already in use.');
            return;
        }

        replacePeerIdInRoomState(state, oldPeerId, newPeerId);

        // This event must precede updatePlayerList so clients can rename the
        // existing seat in place instead of removing and appending a new box.
        io.to(currentRoom).emit('peerIdentityReplaced', { oldPeerId, newPeerId });
        io.to(currentRoom).emit('updatePlayerList', state.players);
        io.to(currentRoom).emit('syncVideoOrder', state.videoOrder || []);
        io.to(currentRoom).emit('syncInitiativeSpotlight', state.initiativePeerId || null);

        respond({ ok: true, oldPeerId, newPeerId });
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
        if (socket.data.skipRoomCleanupForSeatReclaim) return;

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
