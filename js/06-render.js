// Dungeons '85 Public Beta 9.6 — 06-render.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Canvas rendering
// ============================================================

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


