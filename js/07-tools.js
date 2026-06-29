// Dungeons '85 Public Beta 9.6 — 07-tools.js
// Refactor-only split from js/main.js. Preserve load order in index.html.

// ============================================================
// Dice, torch, and turn tracker
// ============================================================

function rollDice(sides) {
        const finalResult = Math.floor(Math.random() * sides) + 1;
        socket.emit('executeDiceRoll', {
            sides, result: finalResult, player: tableState.playerName,
            screenX: Math.floor(15 + Math.random() * 60), screenY: Math.floor(15 + Math.random() * 60)
        });
    }


function executeDiceOverlayAnimation(sides, result, rollerName, posX, posY) {
        const interfaceWrapper = document.getElementById('vtt-interface');
        const container = document.createElement('div'); container.className = 'dice-container-overlay';
        container.style.left = `${posX}%`; container.style.top = `${posY}%`;
        const spriteFrame = document.createElement('div'); spriteFrame.className = 'dice-sprite-frame';
        spriteFrame.style.backgroundImage = `url('assets/dice/d${sides}.png')`;
        const numberOverlay = document.createElement('div'); numberOverlay.className = 'dice-numerical-overlay';
        numberOverlay.innerText = result;
        const labelCard = document.createElement('div'); labelCard.className = 'dice-player-label';
        labelCard.innerText = rollerName;
        spriteFrame.appendChild(numberOverlay); container.appendChild(spriteFrame);
        container.appendChild(labelCard); interfaceWrapper.appendChild(container);
        let frameIdx = 0; const maxTumbleCycles = 12; let frameCounter = 0;
        const tumbleTimer = setInterval(() => {
            frameIdx = (frameIdx + 1) % 6; spriteFrame.style.backgroundPosition = `-${frameIdx * 100}px 0px`;
            frameCounter++;
            if (frameCounter >= maxTumbleCycles) {
                clearInterval(tumbleTimer); spriteFrame.style.backgroundPosition = `-600px 0px`;
                numberOverlay.style.display = 'block'; addResultToHistoryTicker(rollerName, sides, result);
                setTimeout(() => { container.style.opacity = '0'; setTimeout(() => container.remove(), 500); }, 5000);
            }
        }, 75);
    }


function addResultToHistoryTicker(player, sides, result) {
        const ticker = document.getElementById('ticker-log');
        const emptyMsg = document.getElementById('ticker-empty-msg');
        if (emptyMsg) emptyMsg.remove();
        const logEntry = document.createElement('div'); logEntry.className = 'ticker-entry';
        logEntry.innerHTML = sides === 0 
            ? `<span>[SYS]</span> ${result}`
            : `<span>[${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span> ${player} ROLLED D${sides}: ${result}`;
        ticker.appendChild(logEntry);
        ticker.scrollLeft = ticker.scrollWidth;
    }


let torchInterval = null;
let torchSeconds = 0;


function toggleTorchPanel() {
        if (!tableState.isDM) return; 
        document.getElementById('torch-panel').classList.toggle('hidden');
    }


function igniteTorch() {
        clearInterval(torchInterval);
        const randomDeduction = Math.floor(Math.random() * 301);
        torchSeconds = 3600 - randomDeduction;


        document.getElementById('torch-light-btn').classList.add('active');
        document.getElementById('torch-dark-status').classList.remove('active');
        updateTorchDisplay();


        if (tableState.isDarknessActive) {
            tableState.isDarknessActive = false;
            updateFogUI();
            markTableDirty();
            broadcastFoW();
            draw();
            addResultToHistoryTicker("[SYS]", 0, "NEW TORCH IGNITED");
        }


        torchInterval = setInterval(() => {
            torchSeconds--;
            if (torchSeconds <= 0) {
                torchSeconds = 0;
                extinguishTorch();
            }
            updateTorchDisplay();
        }, 1000);
    }


function extinguishTorch() {
        clearInterval(torchInterval);
        document.getElementById('torch-light-btn').classList.remove('active');
        document.getElementById('torch-dark-status').classList.add('active');
        updateTorchDisplay();


        if (!tableState.isDarknessActive) {
            tableState.isDarknessActive = true;
            updateFogUI();
            markTableDirty();
            broadcastFoW();
            draw();
            addResultToHistoryTicker("[SYS]", 0, "TORCH EXPIRED: LIGHTS OUT");
        }
    }


function updateTorchDisplay() {
        const m = Math.floor(torchSeconds / 60).toString().padStart(2, '0');
        const s = (torchSeconds % 60).toString().padStart(2, '0');
        document.getElementById('torch-clock').innerText = `${m}:${s}`;
    }


function toggleTurnTracker() {
        if (!tableState.isDM) return;
        document.getElementById('turn-tracker-panel').classList.toggle('hidden');
    }


function checkTurn(boxNum) {
        const box = document.getElementById(`turn-box-${boxNum}`);
        const msgDiv = document.getElementById('turn-message');


        if (box.classList.contains('checked')) {
            box.classList.remove('checked');
            msgDiv.innerHTML = ""; 
        } else {
            box.classList.add('checked');
            const messages = {
                1: "TURN 1 ELAPSED",
                2: "W: WANDERING MONSTER CHECK",
                3: "TURN 3 ELAPSED",
                4: "W: WANDERING MONSTER CHECK",
                5: "TURN 5 ELAPSED",
                6: "W: WANDERING MONSTER CHECK<br>R: PARTY MUST REST FOR 1 TURN<br>T: TORCH EXPIRES"
            };
            msgDiv.innerHTML = messages[boxNum];
        }
    }


function resetTurns() {
        for(let i = 1; i <= 6; i++) {
            document.getElementById(`turn-box-${i}`).classList.remove('checked');
        }
        document.getElementById('turn-message').innerHTML = "";
    }


