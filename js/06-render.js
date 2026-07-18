// Dungeons '85 Public Beta 9.7.3.4.12 — 06-render.js
// Ordered client module. Preserve script load order in index.html.

// ============================================================
// Canvas rendering
// ============================================================


function ensureCanvasBackingStoreSize() {
    const nextWidth = Math.floor(canvas.clientWidth || canvas.width || 0);
    const nextHeight = Math.floor(canvas.clientHeight || canvas.height || 0);

    if (nextWidth > 0 && nextHeight > 0 && (canvas.width !== nextWidth || canvas.height !== nextHeight)) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        fogCanvas.width = nextWidth;
        fogCanvas.height = nextHeight;
    }
}

function centerMapInView(zoom = DEFAULT_MAP_ZOOM) {
    ensureCanvasBackingStoreSize();

    const nextZoom = Number(zoom);
    tableState.camera.zoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : DEFAULT_MAP_ZOOM;

    // Maps are drawn centered on world origin in draw():
    // ctx.drawImage(mapImgAsset, -mapImgAsset.width / 2, -mapImgAsset.height / 2).
    // Therefore centering the map means placing world origin at the center of
    // the current canvas. This helper also refreshes the canvas backing size
    // first so early map-load syncs do not center against the default 300x150
    // canvas before the visible VTT layout has resized.
    tableState.camera.x = canvas.width / 2;
    tableState.camera.y = canvas.height / 2;
}

function centerCameraOnWorldPoint(worldX, worldY, zoom = tableState.camera.zoom) {
    const nextZoom = Number(zoom);
    tableState.camera.zoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : tableState.camera.zoom;
    tableState.camera.x = canvas.width / 2 - (Number(worldX) || 0) * tableState.camera.zoom;
    tableState.camera.y = canvas.height / 2 - (Number(worldY) || 0) * tableState.camera.zoom;
}

function getCurrentCameraCenterWorld() {
    return {
        centerX: (canvas.width / 2 - tableState.camera.x) / tableState.camera.zoom,
        centerY: (canvas.height / 2 - tableState.camera.y) / tableState.camera.zoom
    };
}

function drawSketchShape(sketch, isDraft = false) {
        if (!sketch || !['line', 'circle', 'rect'].includes(sketch.type)) return;

        const x1 = Number(sketch.x1) || 0;
        const y1 = Number(sketch.y1) || 0;
        const x2 = Number(sketch.x2) || 0;
        const y2 = Number(sketch.y2) || 0;

        ctx.save();
        ctx.strokeStyle = String(sketch.color || '#000000');
        ctx.lineWidth = 3 / tableState.camera.zoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isDraft) ctx.setLineDash([8 / tableState.camera.zoom, 5 / tableState.camera.zoom]);

        if (sketch.type === 'line') {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        } else if (sketch.type === 'rect') {
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (sketch.type === 'circle') {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const radiusX = Math.abs(x2 - x1) / 2;
            const radiusY = Math.abs(y2 - y1) / 2;

            if (radiusX > 0 && radiusY > 0) {
                ctx.beginPath();
                ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

function drawSketches(viewLeft, viewRight, viewTop, viewBottom) {
        if (!Array.isArray(tableState.sketches)) tableState.sketches = [];

        tableState.sketches.forEach(sketch => {
            const minX = Math.min(Number(sketch.x1) || 0, Number(sketch.x2) || 0);
            const maxX = Math.max(Number(sketch.x1) || 0, Number(sketch.x2) || 0);
            const minY = Math.min(Number(sketch.y1) || 0, Number(sketch.y2) || 0);
            const maxY = Math.max(Number(sketch.y1) || 0, Number(sketch.y2) || 0);

            if (maxX < viewLeft - 80 || minX > viewRight + 80 || maxY < viewTop - 80 || minY > viewBottom + 80) {
                return;
            }

            drawSketchShape(sketch);
        });

        if (tableState.isDM && sketchDraft) {
            drawSketchShape(sketchDraft, true);
        }
    }

function drawMapNotes(viewLeft, viewRight, viewTop, viewBottom) {
        if (!Array.isArray(tableState.notes)) return;

        tableState.notes.forEach(note => {
            const noteX = Number(note.x) || 0;
            const noteY = Number(note.y) || 0;
            const label = String(note.label || '').trim();

            if (noteX < viewLeft - 80 || noteX > viewRight + 80 || noteY < viewTop - 80 || noteY > viewBottom + 80) {
                return;
            }

            if (label) {
                ctx.save();
                ctx.font = 'bold 16px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const width = ctx.measureText(label).width;
                const labelWidth = width + 12;
                const labelHeight = 22;
                const labelX = noteX - labelWidth / 2;
                const labelY = noteY - labelHeight / 2;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
                ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
                ctx.fillStyle = '#fff';
                ctx.fillText(label, noteX, noteY);
                ctx.restore();
            }

            if (tableState.isDM && notesVisible) {
                ctx.save();
                ctx.font = 'bold 26px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ff3333';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 4;

                let markerX = noteX;
                if (label) {
                    ctx.font = 'bold 16px monospace';
                    const labelWidth = ctx.measureText(label).width + 12;
                    markerX = noteX - labelWidth / 2 - 14;
                    ctx.font = 'bold 26px monospace';
                }

                ctx.strokeText('!', markerX, noteY);
                ctx.fillText('!', markerX, noteY);
                ctx.restore();
            }
        });
    }

async function draw() {
        ctx.fillStyle = '#000000'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save(); 
        ctx.translate(tableState.camera.x, tableState.camera.y); 
        ctx.scale(tableState.camera.zoom, tableState.camera.zoom);


        const viewLeft = -tableState.camera.x / tableState.camera.zoom;
        const viewRight = (canvas.width - tableState.camera.x) / tableState.camera.zoom;
        const viewTop = -tableState.camera.y / tableState.camera.zoom;
        const viewBottom = (canvas.height - tableState.camera.y) / tableState.camera.zoom;


        let mapImgAsset = tokenImageCache[tableState.mapSrc];
        if (mapImgAsset && mapImgAsset.complete) {
            ctx.drawImage(mapImgAsset, -mapImgAsset.width / 2, -mapImgAsset.height / 2);
        } else {
            ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1;
            const startX = Math.floor(viewLeft / GRID_SIZE) * GRID_SIZE;
            const endX = Math.ceil(viewRight / GRID_SIZE) * GRID_SIZE;
            const startY = Math.floor(viewTop / GRID_SIZE) * GRID_SIZE;
            const endY = Math.ceil(viewBottom / GRID_SIZE) * GRID_SIZE;


            ctx.beginPath();
            for (let i = startX; i <= endX; i += GRID_SIZE) { ctx.moveTo(i, startY); ctx.lineTo(i, endY); }
            for (let i = startY; i <= endY; i += GRID_SIZE) { ctx.moveTo(startX, i); ctx.lineTo(endX, i); }
            ctx.stroke();
        }


        for (let t of tableState.tokens) {
            if (t.hidden && !tableState.isDM) continue;
            if (t.x + t.size / 2 < viewLeft || t.x - t.size / 2 > viewRight || t.y + t.size / 2 < viewTop || t.y - t.size / 2 > viewBottom) {
                continue;
            }


            ctx.save();
            if (tableState.isDM && t.hidden) ctx.globalAlpha = 0.50;
            let imgAsset = tokenImageCache[t.src];
            if (imgAsset && imgAsset.complete) {
                ctx.drawImage(imgAsset, t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
            }
            ctx.restore();
        }


        drawSketches(viewLeft, viewRight, viewTop, viewBottom);
        drawMapNotes(viewLeft, viewRight, viewTop, viewBottom);


        if (tableState.fowEnabled) {
            fogCtx.globalCompositeOperation = 'source-over';
            fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
            fogCtx.fillStyle = tableState.isDM ? 'rgba(0, 0, 0, 0.65)' : '#000000';
            fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);


            fogCtx.save();
            fogCtx.translate(tableState.camera.x, tableState.camera.y);
            fogCtx.scale(tableState.camera.zoom, tableState.camera.zoom);
            fogCtx.globalCompositeOperation = 'destination-out';
            fogCtx.fillStyle = '#000'; 


            for (let poly of tableState.fowPolygons) {
                if (poly.length < 3) continue;
                fogCtx.beginPath();
                fogCtx.moveTo(poly[0].x, poly[0].y);
                for (let i = 1; i < poly.length; i++) {
                    fogCtx.lineTo(poly[i].x, poly[i].y);
                }
                fogCtx.closePath();
                fogCtx.fill(); 
            }
            fogCtx.restore();


            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); 
            ctx.drawImage(fogCanvas, 0, 0);
            ctx.restore();
        }


        if (tableState.isDM && isDrawingFoW && currentFoWPolygon.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2 / tableState.camera.zoom;


            ctx.beginPath();
            ctx.moveTo(currentFoWPolygon[0].x, currentFoWPolygon[0].y);
            for (let i = 1; i < currentFoWPolygon.length; i++) {
                ctx.lineTo(currentFoWPolygon[i].x, currentFoWPolygon[i].y);
            }
            ctx.lineTo(currentMouseWorldX, currentMouseWorldY);
            ctx.stroke();


            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.arc(currentFoWPolygon[0].x, currentFoWPolygon[0].y, 6 / tableState.camera.zoom, 0, Math.PI * 2);
            ctx.fill();


            ctx.restore();
        }


        ctx.restore(); 


        if (tableState.isDarknessActive) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); 
            ctx.fillStyle = tableState.isDM ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.95)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    }


