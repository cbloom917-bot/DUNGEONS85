// Dungeons '85 Public Beta 9.6 — 05-canvas-input.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Canvas interaction: camera, tokens, context menu
// ============================================================

let isDraggingWorkspace = false;
let dragStart = { x: 0, y: 0 };
let selectedToken = null;
let tokenDragChanged = false;


function queueTokenMove(token, forceNow = false) {
        if (!socket || !token) return;

        if (forceNow) {
            if (pendingTokenMoveTimer) {
                clearTimeout(pendingTokenMoveTimer);
                pendingTokenMoveTimer = null;
            }
            pendingTokenMove = null;
            lastTokenMoveEmitAt = Date.now();
            emitTokenMove(token);
            return;
        }

        const now = Date.now();
        const elapsed = now - lastTokenMoveEmitAt;

        if (elapsed >= TOKEN_MOVE_EMIT_INTERVAL_MS) {
            lastTokenMoveEmitAt = now;
            emitTokenMove(token);
            return;
        }

        pendingTokenMove = token;

        if (!pendingTokenMoveTimer) {
            pendingTokenMoveTimer = setTimeout(() => {
                if (pendingTokenMove) {
                    lastTokenMoveEmitAt = Date.now();
                    emitTokenMove(pendingTokenMove);
                }
                pendingTokenMove = null;
                pendingTokenMoveTimer = null;
            }, TOKEN_MOVE_EMIT_INTERVAL_MS - elapsed);
        }
    }

function getWorldPointFromMouseEvent(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            rect,
            worldX: (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom,
            worldY: (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom
        };
    }

function findNoteAt(worldX, worldY) {
        if (!tableState.isDM || !notesVisible || !Array.isArray(tableState.notes)) return null;

        for (let i = tableState.notes.length - 1; i >= 0; i--) {
            const note = tableState.notes[i];
            const noteX = Number(note.x) || 0;
            const noteY = Number(note.y) || 0;
            if (Math.hypot(noteX - worldX, noteY - worldY) < (18 / tableState.camera.zoom)) {
                return note;
            }
        }

        return null;
    }


    canvas.addEventListener('contextmenu', (e) => {
        if (!tableState.isDM) return; 
        e.preventDefault();


        if (isDrawingFoW) {
            currentFoWPolygon = [];
            isDrawingFoW = false;
            updateFogUI();
            draw();
            return;
        }


        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom;
        const worldY = (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom;
        contextSelectedToken = null;
        for (let i = tableState.tokens.length - 1; i >= 0; i--) {
            const t = tableState.tokens[i];
            if (Math.hypot(t.x - worldX, t.y - worldY) < t.size / 2) { contextSelectedToken = t; break; }
        }
        if (contextSelectedToken) {
            ctxMenu.style.left = `${e.clientX}px`; ctxMenu.style.top = `${e.clientY}px`; ctxMenu.style.display = 'block';
        }
    });


    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) return; 
        ctxMenu.style.display = 'none';
        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom;
        const worldY = (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom;


        const clickedNote = findNoteAt(worldX, worldY);
        if (clickedNote) {
            openNoteEditor(clickedNote, worldX, worldY, e.clientX, e.clientY);
            isDraggingWorkspace = false;
            selectedToken = null;
            return;
        }


        if (tableState.isDM && isDrawingFoW && e.button === 0) {
            const dist = currentFoWPolygon.length > 0 ? Math.hypot(currentFoWPolygon[0].x - worldX, currentFoWPolygon[0].y - worldY) : Infinity;


            if (currentFoWPolygon.length > 2 && dist < (20 / tableState.camera.zoom)) {
                tableState.fowPolygons.push([...currentFoWPolygon]);
                currentFoWPolygon = [];
                isDrawingFoW = false;
                updateFogUI();
                markTableDirty();
                broadcastFoW();
            } else {
                currentFoWPolygon.push({x: worldX, y: worldY});
            }
            draw();
            return; 
        }


        selectedToken = null;
        tokenDragChanged = false;
        for (let i = tableState.tokens.length - 1; i >= 0; i--) {
            const t = tableState.tokens[i];
            if (!tableState.isDM && t.hidden) continue;
            if (Math.hypot(t.x - worldX, t.y - worldY) < t.size / 2) {
                selectedToken = t; 
                break; 
            }
        }
        isDraggingWorkspace = !selectedToken; 
        dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });


    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; 
        const mouseY = e.clientY - rect.top;


        currentMouseWorldX = (mouseX - tableState.camera.x) / tableState.camera.zoom;
        currentMouseWorldY = (mouseY - tableState.camera.y) / tableState.camera.zoom;


        if (tableState.isDM && isDrawingFoW && currentFoWPolygon.length > 0) {
            draw(); 
        }


        if (!isDraggingWorkspace && !selectedToken) return;


        const dx = (mouseX - dragStart.x) / tableState.camera.zoom;
        const dy = (mouseY - dragStart.y) / tableState.camera.zoom;


        if (selectedToken) {
            selectedToken.x += dx;
            selectedToken.y += dy;
            tokenDragChanged = true;
            queueTokenMove(selectedToken);
        } else if (isDraggingWorkspace) {
            tableState.camera.x += (mouseX - dragStart.x);
            tableState.camera.y += (mouseY - dragStart.y);
        }
        dragStart = { x: mouseX, y: mouseY }; 
        draw();
    });


    window.addEventListener('mouseup', () => {
        if (selectedToken && tokenDragChanged) {
            markTableDirty();
            queueTokenMove(selectedToken, true);
        }
        isDraggingWorkspace = false; selectedToken = null; tokenDragChanged = false;
    });


    canvas.addEventListener('dblclick', (e) => {
        if (!tableState.isDM || !notesVisible || isDrawingFoW) return;

        const { worldX, worldY } = getWorldPointFromMouseEvent(e);

        for (let i = tableState.tokens.length - 1; i >= 0; i--) {
            const t = tableState.tokens[i];
            if (Math.hypot(t.x - worldX, t.y - worldY) < t.size / 2) return;
        }

        if (findNoteAt(worldX, worldY)) return;

        openNoteEditor(null, worldX, worldY, e.clientX, e.clientY);
    });


    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) tableState.camera.zoom *= 1.1; else tableState.camera.zoom /= 1.1;
        draw();
    });


function executeContextResize(newSize) {
        if (!contextSelectedToken) return;
        contextSelectedToken.size = newSize;
        markTableDirty();
        draw();
        emitTokenResize(contextSelectedToken);
    }


function executeContextReveal() {
        if (!contextSelectedToken) return; contextSelectedToken.hidden = !contextSelectedToken.hidden;
        markTableDirty();
        draw(); emitTokenVisibility(contextSelectedToken);
    }


function executeContextDuplicate() {
        if (!contextSelectedToken) return;
        const clone = {
            id: "token-" + Date.now() + Math.random(), src: contextSelectedToken.src,
            x: contextSelectedToken.x + 20, y: contextSelectedToken.y,
            size: contextSelectedToken.size, hidden: contextSelectedToken.hidden
        };
        tableState.tokens.push(clone); markTableDirty(); draw(); emitTokenAdd(clone);
    }


function executeContextDelete() {
        if (!contextSelectedToken) return;
        const deletedTokenId = contextSelectedToken.id;
        tableState.tokens = tableState.tokens.filter(t => t.id !== deletedTokenId);
        markTableDirty();
        draw(); emitTokenDelete(deletedTokenId);
    }


function makeElementsDraggable() {
        document.querySelectorAll('.toolbar').forEach(toolbar => {
            const handle = toolbar.querySelector('.panel-label');
            let xOffset = 0, yOffset = 0, xStart = 0, yStart = 0;
            handle.onmousedown = (e) => {
                xStart = e.clientX; yStart = e.clientY;
                document.onmousemove = (ev) => {
                    ev.preventDefault();
                    xOffset = xStart - ev.clientX; yOffset = yStart - ev.clientY;
                    xStart = ev.clientX; yStart = ev.clientY;
                    toolbar.style.top = (toolbar.offsetTop - yOffset) + "px";
                    toolbar.style.left = (toolbar.offsetLeft - xOffset) + "px";
                };
                document.onmouseup = () => { document.onmousemove = null; document.onmouseup = null; };
            };
        });
    }


