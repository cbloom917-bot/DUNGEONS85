// Dungeons '85 Public Beta 9.6 — 06-render.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Canvas rendering
// ============================================================


function centerMapInView(zoom = DEFAULT_MAP_ZOOM) {
    const nextZoom = Number(zoom);
    tableState.camera.zoom = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : DEFAULT_MAP_ZOOM;
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
                ctx.textBaseline = 'top';
                const width = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
                ctx.fillRect(noteX + 10, noteY - 8, width + 8, 22);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.strokeRect(noteX + 10, noteY - 8, width + 8, 22);
                ctx.fillStyle = '#fff';
                ctx.fillText(label, noteX + 14, noteY - 5);
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
                ctx.strokeText('!', noteX, noteY);
                ctx.fillText('!', noteX, noteY);
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


