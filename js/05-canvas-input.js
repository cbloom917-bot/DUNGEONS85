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


function normalizeSketchEndPoint(startX, startY, endX, endY, type, constrain) {
        if (!constrain) return { x: endX, y: endY };

        const dx = endX - startX;
        const dy = endY - startY;

        if (type === 'line') {
            const angle = Math.atan2(dy, dx);
            const distance = Math.hypot(dx, dy);
            const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            return {
                x: startX + Math.cos(snappedAngle) * distance,
                y: startY + Math.sin(snappedAngle) * distance
            };
        }

        if (type === 'rect' || type === 'circle') {
            const size = Math.max(Math.abs(dx), Math.abs(dy));
            return {
                x: startX + Math.sign(dx || 1) * size,
                y: startY + Math.sign(dy || 1) * size
            };
        }

        return { x: endX, y: endY };
    }

function createSketchFromDraft(draft) {
        if (!draft) return null;

        return {
            id: `sketch-${Date.now()}-${Math.random()}`,
            type: draft.type,
            x1: draft.x1,
            y1: draft.y1,
            x2: draft.x2,
            y2: draft.y2,
            color: draft.color
        };
    }

function getSketchBounds(sketch) {
        const x1 = Number(sketch.x1) || 0;
        const y1 = Number(sketch.y1) || 0;
        const x2 = Number(sketch.x2) || 0;
        const y2 = Number(sketch.y2) || 0;
        return {
            minX: Math.min(x1, x2),
            maxX: Math.max(x1, x2),
            minY: Math.min(y1, y2),
            maxY: Math.max(y1, y2),
            x1,
            y1,
            x2,
            y2
        };
    }

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;

        if (!lengthSq) return Math.hypot(px - x1, py - y1);

        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

function findSketchAt(worldX, worldY) {
        if (!tableState.isDM || !Array.isArray(tableState.sketches)) return null;

        const hitPadding = 10 / tableState.camera.zoom;

        for (let i = tableState.sketches.length - 1; i >= 0; i--) {
            const sketch = tableState.sketches[i];
            const bounds = getSketchBounds(sketch);

            if (sketch.type === 'line') {
                if (distanceToLineSegment(worldX, worldY, bounds.x1, bounds.y1, bounds.x2, bounds.y2) <= hitPadding) return sketch;
            } else if (sketch.type === 'rect') {
                const nearHorizontal = worldX >= bounds.minX - hitPadding && worldX <= bounds.maxX + hitPadding &&
                    (Math.abs(worldY - bounds.minY) <= hitPadding || Math.abs(worldY - bounds.maxY) <= hitPadding);
                const nearVertical = worldY >= bounds.minY - hitPadding && worldY <= bounds.maxY + hitPadding &&
                    (Math.abs(worldX - bounds.minX) <= hitPadding || Math.abs(worldX - bounds.maxX) <= hitPadding);
                if (nearHorizontal || nearVertical) return sketch;
            } else if (sketch.type === 'circle') {
                const centerX = (bounds.x1 + bounds.x2) / 2;
                const centerY = (bounds.y1 + bounds.y2) / 2;
                const radiusX = Math.abs(bounds.x2 - bounds.x1) / 2;
                const radiusY = Math.abs(bounds.y2 - bounds.y1) / 2;
                if (radiusX > 0 && radiusY > 0) {
                    const normalized = Math.sqrt(
                        Math.pow((worldX - centerX) / radiusX, 2) +
                        Math.pow((worldY - centerY) / radiusY, 2)
                    );
                    if (Math.abs(normalized - 1) <= 0.12 + hitPadding / Math.max(radiusX, radiusY)) return sketch;
                }
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

        if (sketchDraft) {
            sketchDraft = null;
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


        if (tableState.isDM && activeSketchTool) {
            if (activeSketchTool === 'eraser') {
                const sketch = findSketchAt(worldX, worldY);
                if (sketch) {
                    tableState.sketches = tableState.sketches.filter(item => item.id !== sketch.id);
                    markTableDirty();
                    broadcastSketches();
                    draw();
                }
                return;
            }

            const activeColor = SKETCH_COLORS[sketchToolColors[activeSketchTool] || 0];
            sketchDraft = {
                type: activeSketchTool,
                x1: worldX,
                y1: worldY,
                x2: worldX,
                y2: worldY,
                color: activeColor.value
            };
            isDraggingWorkspace = false;
            selectedToken = null;
            tokenDragChanged = false;
            draw();
            return;
        }

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


        if (tableState.isDM && sketchDraft) {
            const nextPoint = normalizeSketchEndPoint(sketchDraft.x1, sketchDraft.y1, currentMouseWorldX, currentMouseWorldY, sketchDraft.type, e.shiftKey);
            sketchDraft.x2 = nextPoint.x;
            sketchDraft.y2 = nextPoint.y;
            draw();
            return;
        }

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


    window.addEventListener('mouseup', (e) => {
        if (tableState.isDM && sketchDraft) {
            const rect = canvas.getBoundingClientRect();
            const worldX = (e.clientX - rect.left - tableState.camera.x) / tableState.camera.zoom;
            const worldY = (e.clientY - rect.top - tableState.camera.y) / tableState.camera.zoom;
            const nextPoint = normalizeSketchEndPoint(sketchDraft.x1, sketchDraft.y1, worldX, worldY, sketchDraft.type, e.shiftKey);
            sketchDraft.x2 = nextPoint.x;
            sketchDraft.y2 = nextPoint.y;

            if (Math.hypot(sketchDraft.x2 - sketchDraft.x1, sketchDraft.y2 - sketchDraft.y1) > 2 / tableState.camera.zoom) {
                if (!Array.isArray(tableState.sketches)) tableState.sketches = [];
                tableState.sketches.push(createSketchFromDraft(sketchDraft));
                markTableDirty();
                broadcastSketches();
            }

            sketchDraft = null;
            draw();
            return;
        }

        if (selectedToken && tokenDragChanged) {
            markTableDirty();
            queueTokenMove(selectedToken, true);
        }
        isDraggingWorkspace = false; selectedToken = null; tokenDragChanged = false;
    });


    canvas.addEventListener('dblclick', (e) => {
        if (!tableState.isDM || !notesVisible || isDrawingFoW || activeSketchTool) return;

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

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const oldZoom = Number(tableState.camera.zoom) || 1;
        const worldX = (mouseX - tableState.camera.x) / oldZoom;
        const worldY = (mouseY - tableState.camera.y) / oldZoom;
        const newZoom = e.deltaY < 0 ? oldZoom * 1.1 : oldZoom / 1.1;

        tableState.camera.zoom = newZoom;
        tableState.camera.x = mouseX - worldX * newZoom;
        tableState.camera.y = mouseY - worldY * newZoom;
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


