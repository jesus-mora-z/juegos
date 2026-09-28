const fs = require('fs');
const file = 'public/client.js';
let js = fs.readFileSync(file, 'utf8');

// 1. Add Drag logic for global-chat
const dragLogic = `
// Drag Logic for Chat
const chatHeader = document.getElementById('chat-header');
let isDragging = false;
let offsetX, offsetY;

chatHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - globalChat.getBoundingClientRect().left;
    offsetY = e.clientY - globalChat.getBoundingClientRect().top;
    globalChat.style.right = 'auto'; // Disable right/bottom if set
});

document.addEventListener('mousemove', (e) => {
    if (isDragging) {
        globalChat.style.left = (e.clientX - offsetX) + 'px';
        globalChat.style.top = (e.clientY - offsetY) + 'px';
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
});
`;

js = js.replace('// Chat Logic', dragLogic + '\n// Chat Logic');

// 2. Helper to render radial players
const radialHelper = `
function renderPlayersRadial(state, containerEl, isPoker = false) {
    containerEl.innerHTML = '';
    let playerIds = Object.keys(state.players);
    if (playerIds.length === 0) return;

    // Sort so myId is at the bottom (first in the array will be mapped to 90 degrees)
    let sortedIds = [...playerIds];
    if (myId && sortedIds.includes(myId)) {
        sortedIds = sortedIds.filter(id => id !== myId);
        sortedIds.unshift(myId);
    }

    const totalPlayers = sortedIds.length;
    // Radius values in % (how far from center)
    // Table is an oval (stadium), so width is larger than height. 
    // We adjust X/Y percentages so players sit on the border.
    const rx = 48; 
    const ry = 48; 

    sortedIds.forEach((id, index) => {
        const p = state.players[id];
        const isMe = (id === myId);
        
        let currentActiveId = state.roundPlayers ? state.roundPlayers[state.currentPlayerIndex] : null;
        let isActive = false;
        
        if (isPoker) {
            isActive = (id === currentActiveId && state.status !== 'WAITING' && state.status !== 'SHOWDOWN');
        } else {
            isActive = (id === currentActiveId && state.status === 'PLAYING');
        }

        let cardsHtml = '';
        p.cards.forEach(c => cardsHtml += renderCard(c));

        let stateText = '';
        if (isPoker) {
            if (p.state === 'FOLDED') stateText = 'NO VOY';
            else if (p.state === 'ALL_IN') stateText = 'ALL-IN';
            else if (p.state === 'WAITING') stateText = 'ESPERANDO';
            else if (p.state === 'PLAYING') stateText = 'JUGANDO';
        } else {
            if (p.state === 'WON') stateText = 'GANASTE';
            else if (p.state === 'LOST') stateText = 'PERDISTE';
            else if (p.state === 'BUST') stateText = 'VOLÓ';
            else if (p.state === 'WON_BLACKJACK') stateText = 'BLACKJACK';
            else if (p.state === 'PUSH') stateText = 'EMPATE';
            else if (p.state === 'STAND') stateText = 'PLANTADO';
            else if (p.state === 'PLAYING') stateText = 'JUGANDO';
        }

        // Calculate position
        let angleOffset = Math.PI / 2; // Bottom center
        let angle = angleOffset + (index * (2 * Math.PI / totalPlayers));
        
        if (totalPlayers === 2 && index === 1) {
            angle = -Math.PI / 2; // Top center
        }

        let left = 50 + rx * Math.cos(angle);
        let top = 50 + ry * Math.sin(angle);

        const pEl = document.createElement('div');
        pEl.className = \`player \${isActive ? 'active-turn' : ''}\`;
        if (isPoker && p.state === 'FOLDED') pEl.style.opacity = '0.5';
        
        pEl.style.left = \`\${left}%\`;
        pEl.style.top = \`\${top}%\`;

        let role = '';
        if (isPoker) {
            let roleIdx = state.roundPlayers.indexOf(id);
            if (roleIdx !== -1) {
                if (roleIdx === state.dealerIndex) role = ' [D]';
                else if (roleIdx === (state.dealerIndex + 1) % state.roundPlayers.length) role = ' [SB]';
                else if (roleIdx === (state.dealerIndex + 2) % state.roundPlayers.length) role = ' [BB]';
            }
        }

        // Display
        let statsHtml = '';
        if (isPoker) {
            statsHtml = \`<span class="chip-emoji"></span> \${p.balance} <br> Apuesta: $\${p.currentRoundBet}\`;
        } else {
            statsHtml = \`<span class="chip-emoji"></span> \${p.balance} <br> Apuesta: \${p.mainBet} \${p.sideBet > 0 ? \`(+$\${p.sideBet} PP)\` : ''}\`;
        }

        let extraHtml = '';
        if (isPoker) {
            extraHtml = \`<div class="sidebet-result" style="color:#00ffcc; font-size:12px;">\${p.handDescription || ''}</div>\`;
        } else {
            extraHtml = \`<div class="score">Ptos: \${p.score || 0}</div>
                         <div class="sidebet-result">\${p.sideBetResult || ''}</div>\`;
        }

        pEl.innerHTML = \`
            <div class="player-info">
                <h3 style="margin:5px 0; font-size:14px;">\${p.name} \${isMe ? '(Tú)' : ''} <span style="color:#ffd700">\${role}</span></h3>
                <div class="player-stats" style="margin:0;">\${statsHtml}</div>
                \${extraHtml}
                <div class="player-state">\${stateText}</div>
            </div>
            <div class="cards-container" style="transform: scale(0.65);">
                \${cardsHtml}
            </div>
        \`;
        containerEl.appendChild(pEl);

        if (isMe) {
            if (isPoker) pokerMyBalance.innerText = p.balance;
            else myBalanceDisplay.innerText = p.balance;
        }
    });
}
`;

js = js.replace('// Blackjack State handler', radialHelper + '\n// Blackjack State handler');

// 3. Replace the old Blackjack players loop with the new function
js = js.replace(/playersArea\.innerHTML = '';[\s\S]*?if \(me\)/, `
    renderPlayersRadial(state, playersArea, false);
    const me = state.players[myId];
    if (me) {
`);

// 4. Replace the old Poker players loop with the new function
js = js.replace(/pokerPlayersArea\.innerHTML = '';[\s\S]*?const me = state\.players\[myId\];/, `
    renderPlayersRadial(state, pokerPlayersArea, true);
    const me = state.players[myId];
`);

fs.writeFileSync(file, js);
console.log('JS patched!');
