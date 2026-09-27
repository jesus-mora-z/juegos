const socket = io();

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen'); // Blackjack Screen
const pokerScreen = document.getElementById('poker-screen');

const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('login-btn');
const btnBj = document.getElementById('btn-bj');
const btnPoker = document.getElementById('btn-poker');
const leaveRoomBtns = document.querySelectorAll('.leave-room');

// Chat DOM
const globalChat = document.getElementById('global-chat');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

// Blackjack DOM
const statusBar = document.getElementById('status-bar');
const dealerCardsContainer = document.getElementById('dealer-cards');
const dealerScoreDisplay = document.getElementById('dealer-score');
const playersArea = document.getElementById('players-area');
const myBalanceDisplay = document.getElementById('my-balance-display');
const bettingControls = document.getElementById('betting-controls');
const playingControls = document.getElementById('playing-controls');
const mainBetInput = document.getElementById('main-bet-amount');
const sideBetInput = document.getElementById('side-bet-amount');
const betBtn = document.getElementById('bet-btn');
const hitBtn = document.getElementById('hit-btn');
const standBtn = document.getElementById('stand-btn');
const doubleBtn = document.getElementById('double-btn');

// Poker DOM
const pokerPot = document.getElementById('poker-pot');
const pokerCommunityCards = document.getElementById('poker-community-cards');
const pokerStatusBar = document.getElementById('poker-status-bar');
const pokerPlayersArea = document.getElementById('poker-players-area');
const pokerMyBalance = document.getElementById('poker-my-balance');
const pokerStartControl = document.getElementById('poker-start-control');
const pokerStartBtn = document.getElementById('poker-start-btn');
const pokerPlayingControls = document.getElementById('poker-playing-controls');
const pokerFoldBtn = document.getElementById('poker-fold-btn');
const pokerCallBtn = document.getElementById('poker-call-btn');
const pokerRaiseBtn = document.getElementById('poker-raise-btn');
const pokerRaiseInput = document.getElementById('poker-raise-amount');

let myId = null;
let myName = '';

// Helpers
function getSuitSymbol(suit) {
    switch(suit) {
        case 'Hearts': return '♥';
        case 'Diamonds': return '♦';
        case 'Clubs': return '♣';
        case 'Spades': return '♠';
        default: return '';
    }
}
function getSuitColor(suit) {
    return (suit === 'Hearts' || suit === 'Diamonds') ? 'red' : 'black';
}
function renderCard(cardData) {
    if (cardData.hidden) {
        return `<div class="card hidden-card"></div>`;
    }
    const color = getSuitColor(cardData.suit);
    const symbol = getSuitSymbol(cardData.suit);
    return `
        <div class="card ${color}">
            <div class="card-top"><span>${cardData.value}</span><span>${symbol}</span></div>
            <div class="card-center">${symbol}</div>
            <div class="card-bottom"><span>${cardData.value}</span><span>${symbol}</span></div>
        </div>
    `;
}
function calculateScoreLocal(cards) {
    let score = 0;
    let aces = 0;
    for (let card of cards) {
        if (!card || card.hidden) continue;
        if (['J', 'Q', 'K'].includes(card.value)) {
            score += 10;
        } else if (card.value === 'A') {
            score += 11;
            aces += 1;
        } else {
            score += parseInt(card.value);
        }
    }
    while (score > 21 && aces > 0) { score -= 10; aces -= 1; }
    return score;
}

// Navigation
loginBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myName = name;
        socket.emit('setPlayerInfo', { name });
        loginScreen.classList.add('hidden');
        lobbyScreen.classList.remove('hidden');
        globalChat.classList.remove('hidden'); // Mostrar chat después de login
        chatDot.classList.remove('hidden');
        setChatOpen(true);
    }
});


// ---- Chat flotante: se arrastra, cambia de tamaño y se recoge en un punto si no se usa ----
const chatHeader = document.getElementById('chat-header');
const chatDot = document.getElementById('chat-dot');
const chatBadge = document.getElementById('chat-badge');
const chatMinBtn = document.getElementById('chat-min-btn');
const CHAT_IDLE_MS = 8000;
let chatOpen = true;
let chatUnread = 0;
let chatIdleTimer = null;

function chatSave(key, value) {
    try { localStorage.setItem('chat.' + key, JSON.stringify(value)); } catch (e) { /* sin almacenamiento */ }
}
function chatLoad(key) {
    try { return JSON.parse(localStorage.getItem('chat.' + key)); } catch (e) { return null; }
}

// Restaura posición y tamaño guardados
(() => {
    const pos = chatLoad('pos');
    const size = chatLoad('size');
    if (pos) placeChat(pos.left, pos.top);
    if (size) { globalChat.style.width = size.w + 'px'; globalChat.style.height = size.h + 'px'; }
})();

function placeChat(left, top) {
    left = Math.max(0, Math.min(window.innerWidth - 50, left));
    top = Math.max(0, Math.min(window.innerHeight - 40, top));
    for (const el of [globalChat, chatDot]) {
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.right = 'auto';
    }
}

function setChatOpen(open) {
    chatOpen = open;
    globalChat.classList.toggle('collapsed', !open);
    chatDot.classList.toggle('collapsed', open);
    if (open) {
        chatUnread = 0;
        chatBadge.classList.add('hidden');
        chatMessages.scrollTop = chatMessages.scrollHeight;
        scheduleChatIdle();
    }
}

function scheduleChatIdle() {
    clearTimeout(chatIdleTimer);
    chatIdleTimer = setTimeout(() => {
        if (document.activeElement !== chatInput && !globalChat.matches(':hover')) setChatOpen(false);
    }, CHAT_IDLE_MS);
}

globalChat.addEventListener('mouseenter', () => clearTimeout(chatIdleTimer));
globalChat.addEventListener('mouseleave', scheduleChatIdle);
chatInput.addEventListener('blur', scheduleChatIdle);
chatMinBtn.addEventListener('click', (e) => { e.stopPropagation(); setChatOpen(false); });

// Arrastrar desde el encabezado o desde el punto (si casi no se mueve, el punto abre el chat)
function makeChatDraggable(handle, onClick) {
    handle.addEventListener('pointerdown', (e) => {
        if (e.target === chatMinBtn) return;
        const rect = handle === chatDot ? chatDot.getBoundingClientRect() : globalChat.getBoundingClientRect();
        const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        const move = (ev) => {
            if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
            if (moved) placeChat(ev.clientX - offX, ev.clientY - offY);
        };
        const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            if (moved) chatSave('pos', { left: parseInt(globalChat.style.left), top: parseInt(globalChat.style.top) });
            else if (onClick) onClick();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });
}
makeChatDraggable(chatHeader);
makeChatDraggable(chatDot, () => { setChatOpen(true); chatInput.focus(); });

// Guarda el tamaño cuando se ajusta desde la esquina
if (window.ResizeObserver) {
    new ResizeObserver(() => {
        if (chatOpen && !globalChat.classList.contains('hidden')) {
            chatSave('size', { w: globalChat.offsetWidth, h: globalChat.offsetHeight });
        }
    }).observe(globalChat);
}

chatInput.addEventListener('keydown', (e) => {
    scheduleChatIdle();
    if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg !== '') {
            socket.emit('chatMessage', msg);
            chatInput.value = '';
        }
    }
});

socket.on('chatMessage', (data) => {
    const msgEl = document.createElement('div');
    const nameEl = document.createElement('strong');
    nameEl.textContent = data.name + ':';
    msgEl.append(nameEl, ' ' + data.msg);
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (!chatOpen) {
        chatUnread++;
        chatBadge.textContent = chatUnread > 9 ? '9+' : chatUnread;
        chatBadge.classList.remove('hidden');
        chatDot.classList.remove('ping');
        void chatDot.offsetWidth;
        chatDot.classList.add('ping');
    }
});

btnBj.addEventListener('click', () => {
    socket.emit('joinRoom', 'blackjack');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
});

btnPoker.addEventListener('click', () => {
    socket.emit('joinRoom', 'poker');
    lobbyScreen.classList.add('hidden');
    pokerScreen.classList.remove('hidden');
});

const btnMonopoly = document.getElementById('btn-monopoly');
btnMonopoly.addEventListener('click', () => {
    socket.emit('joinRoom', 'monopoly');
    lobbyScreen.classList.add('hidden');
    monopolyScreen.classList.remove('hidden');
});


leaveRoomBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        window.location.reload();
    });
});

// ================= BLACKJACK EVENTS =================
betBtn.addEventListener('click', () => {
    const mainBet = parseInt(mainBetInput.value) || 0;
    const sideBet = parseInt(sideBetInput.value) || 0;
    if (mainBet >= 10) {
        socket.emit('placeBet', { mainBet, sideBet });
        bettingControls.classList.add('hidden');
    } else {
        alert("La apuesta mínima es de 10 fichas.");
    }
});
hitBtn.addEventListener('click', () => socket.emit('hit'));
standBtn.addEventListener('click', () => socket.emit('stand'));
doubleBtn.addEventListener('click', () => socket.emit('doubleDown'));

// ================= POKER EVENTS =================
pokerStartBtn.addEventListener('click', () => socket.emit('startPoker'));
pokerFoldBtn.addEventListener('click', () => socket.emit('pokerAction', { action: 'fold' }));
pokerCallBtn.addEventListener('click', () => socket.emit('pokerAction', { action: 'call' }));
pokerRaiseBtn.addEventListener('click', () => {
    const amount = parseInt(pokerRaiseInput.value) || 0;
    if (amount > 0) {
        socket.emit('pokerAction', { action: 'raise', amount });
        pokerRaiseInput.value = '';
    } else {
        alert('Ingresa una cantidad válida para subir.');
    }
});

// ================= SOCKETS =================
socket.on('connect', () => { myId = socket.id; });


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
        pEl.className = `player ${isActive ? 'active-turn' : ''}`;
        if (isPoker && p.state === 'FOLDED') pEl.style.opacity = '0.5';
        
        pEl.style.left = `${left}%`;
        pEl.style.top = `${top}%`;

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
            statsHtml = `<span class="chip-emoji"></span> ${p.balance} <br> Apuesta: ${p.currentRoundBet}`;
        } else {
            statsHtml = `<span class="chip-emoji"></span> ${p.balance} <br> Apuesta: ${p.mainBet} ${p.sideBet > 0 ? `(+${p.sideBet} PP)` : ''}`;
        }

        let extraHtml = '';
        if (isPoker) {
            extraHtml = `<div class="sidebet-result" style="color:#00ffcc; font-size:12px;">${p.handDescription || ''}</div>`;
        } else {
            extraHtml = `<div class="score">Ptos: ${p.score || 0}</div>
                         <div class="sidebet-result">${p.sideBetResult || ''}</div>`;
        }

        pEl.innerHTML = `
            <div class="player-info">
                <h3 style="margin:5px 0; font-size:14px;">${p.name} ${isMe ? '(Tú)' : ''} <span style="color:#ffd700">${role}</span></h3>
                <div class="player-stats" style="margin:0;">${statsHtml}</div>
                ${extraHtml}
                <div class="player-state">${stateText}</div>
            </div>
            <div class="cards-container" style="transform: scale(0.65);">
                ${cardsHtml}
            </div>
        `;
        containerEl.appendChild(pEl);

        if (isMe) {
            if (isPoker) pokerMyBalance.innerText = p.balance;
            else myBalanceDisplay.innerText = p.balance;
        }
    });
}

// Blackjack State handler
socket.on('gameState', (state) => {
    // Reset controles primero
    bettingControls.classList.add('hidden');
    playingControls.classList.add('hidden');

    dealerCardsContainer.innerHTML = '';
    state.dealerCards.forEach(card => {
        dealerCardsContainer.innerHTML += renderCard(card);
    });
    if (['DEALER_TURN', 'RESOLUTION'].includes(state.status)) {
        dealerScoreDisplay.innerText = `Puntos: ${calculateScoreLocal(state.dealerCards)}`;
    } else {
        dealerScoreDisplay.innerText = '';
    }

    let statusMsg = '';
    switch(state.status) {
        case 'WAITING': statusMsg = 'Esperando jugadores...'; break;
        case 'BETTING': statusMsg = '¡Hagan sus apuestas! (Fichas mín. 10)'; break;
        case 'DEALING': statusMsg = 'Repartiendo...'; break;
        case 'PLAYING': 
            let activeId = state.roundPlayers[state.currentPlayerIndex];
            statusMsg = (activeId === myId) ? '¡Es tu turno!' : `Turno de ${state.players[activeId]?.name || 'alguien'}...`;
            break;
        case 'DEALER_TURN': statusMsg = 'Turno del Crupier...'; break;
        case 'RESOLUTION': statusMsg = 'Resolviendo apuestas...'; break;
    }
    statusBar.innerText = statusMsg;

    try {
        renderPlayersRadial(state, playersArea, false);
    } catch(e) {
        console.error('Error renderPlayersRadial BJ:', e);
    }

    const me = state.players[myId];
    const currentActiveId = state.roundPlayers[state.currentPlayerIndex];
    if (me) {
        myBalanceDisplay.innerText = me.balance;
        if (state.status === 'BETTING' && me.mainBet === 0 && me.balance >= 10) {
            bettingControls.classList.remove('hidden');
            mainBetInput.max = me.balance;
        } else if (state.status === 'PLAYING' && currentActiveId === myId && me.state === 'PLAYING') {
            playingControls.classList.remove('hidden');
            if (me.cards.length === 2 && me.balance >= me.mainBet) {
                doubleBtn.classList.remove('hidden');
            }
        }
    }
});

// Poker State handler
socket.on('pokerGameState', (state) => {
    pokerPot.innerText = `Bote: $${state.pot} | Apuesta más alta: $${state.highestBet}`;
    
    pokerCommunityCards.innerHTML = '';
    state.communityCards.forEach(card => {
        pokerCommunityCards.innerHTML += renderCard(card);
    });

    let statusMsg = '';
    switch(state.status) {
        case 'WAITING': statusMsg = 'Esperando jugadores para iniciar...'; break;
        case 'PREFLOP': statusMsg = 'Pre-Flop: Empiezan las apuestas'; break;
        case 'FLOP': statusMsg = 'Flop: 3 cartas comunitarias'; break;
        case 'TURN': statusMsg = 'Turn: 4ta carta comunitaria'; break;
        case 'RIVER': statusMsg = 'River: Última carta comunitaria'; break;
        case 'SHOWDOWN': statusMsg = 'Showdown: Resolviendo cartas...'; break;
    }
    
    let currentActiveId = state.roundPlayers[state.currentPlayerIndex];
    if (state.status !== 'WAITING' && state.status !== 'SHOWDOWN') {
        if (currentActiveId === myId) {
            statusMsg = '¡ES TU TURNO!';
        } else {
            let activeName = state.players[currentActiveId] ? state.players[currentActiveId].name : 'alguien';
            statusMsg += ` | Turno de ${activeName}`;
        }
    }
    pokerStatusBar.innerText = statusMsg;

    try {
        renderPlayersRadial(state, pokerPlayersArea, true);
    } catch(e) {
        console.error('Error renderPlayersRadial Poker:', e);
    }
    const me = state.players[myId];

    pokerStartControl.classList.add('hidden');
    pokerPlayingControls.classList.add('hidden');

    if (state.status === 'WAITING' && Object.keys(state.players).length >= 2) {
        pokerStartControl.classList.remove('hidden');
    }

    if (me && currentActiveId === myId && me.state === 'PLAYING' && state.status !== 'WAITING' && state.status !== 'SHOWDOWN') {
        pokerPlayingControls.classList.remove('hidden');
        
        let callAmount = state.highestBet - me.currentRoundBet;
        if (callAmount === 0) {
            pokerCallBtn.innerText = 'Pasar (Check)';
        } else {
            pokerCallBtn.innerText = `Igualar $${callAmount} (Call)`;
        }
    }
});

// ================= MONOPOLY DOM & LOGIC =================
const monopolyScreen = document.getElementById('monopoly-screen');
const monopolyMyBalance = document.getElementById('monopoly-my-balance');
const monopolyBoard = document.getElementById('monopoly-board');
const monopolyMessage = document.getElementById('monopoly-message');
const monopolyCurrentPlayer = document.getElementById('monopoly-current-player');
const monopolyTimer = document.getElementById('monopoly-timer');
const monopolyCard = document.getElementById('monopoly-card');
const monopolyPlayersPanel = document.getElementById('monopoly-players-panel');
const monopolyControls = document.getElementById('monopoly-controls');
const monoStartBtn = document.getElementById('mono-start-btn');
const monoRollBtn = document.getElementById('mono-roll-btn');
const monoBuyBtn = document.getElementById('mono-buy-btn');
const monoSkipBtn = document.getElementById('mono-skip-btn');
const monoEndBtn = document.getElementById('mono-end-btn');
const monoPayJailBtn = document.getElementById('mono-pay-jail-btn');
const monoJailCardBtn = document.getElementById('mono-jail-card-btn');
const monoHand = document.getElementById('mono-hand');
const monoDeedPopup = document.getElementById('mono-deed-popup');

const MONO_JAIL_FINE = 50;
const MONO_HOTEL = 5;              // houses === 5 es un hotel
const MONO_GO_SALARY = 200;

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

// Monopoly Events
const monoAction = (action, extra = {}) => socket.emit('monopolyAction', { action, ...extra });
monoStartBtn.addEventListener('click', () => socket.emit('startMonopoly'));
monoRollBtn.addEventListener('click', () => monoAction('rollDice'));
monoBuyBtn.addEventListener('click', () => monoAction('buyProperty'));
monoSkipBtn.addEventListener('click', () => monoAction('skipBuy'));
monoEndBtn.addEventListener('click', () => monoAction('endTurn'));
monoPayJailBtn.addEventListener('click', () => monoAction('payJail'));
monoJailCardBtn.addEventListener('click', () => monoAction('useJailCard'));

let lastMonoState = null;

// Botones de las cartas de la mano: construir, vender, hipotecar, levantar hipoteca
monoHand.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-deed-action]');
    if (btn) monoAction(btn.dataset.deedAction, { propertyId: Number(btn.dataset.prop) });
});

// Clic en una propiedad del tablero: muestra su tarjeta ampliada
function openMonoDeed(pos) {
    if (!lastMonoState) return;
    const space = lastMonoState.board[pos];
    if (!space || !MONO_OWNABLE.includes(space.type)) return;
    monoDeedPopup.innerHTML = renderDeedCard(space, lastMonoState, { large: true })
        + '<div class="deed-popup-hint">Clic para cerrar</div>';
    monoDeedPopup.classList.remove('hidden');
}
monopolyBoard.addEventListener('click', (e) => {
    const cell = e.target.closest('.mono-cell[data-pos]');
    if (cell) openMonoDeed(Number(cell.dataset.pos));
});
monoDeedPopup.addEventListener('click', () => monoDeedPopup.classList.add('hidden'));

// Tablero horizontal de 9 columnas x 5 filas; la casilla 0 (Salida) está abajo a la derecha
// y el recorrido va en sentido horario: abajo → izquierda → arriba → derecha.
const MONO_COLS = 11;
const MONO_ROWS = 11;
const MONO_OWNABLE = ['property', 'railroad', 'utility'];
function monoGridPosition(pos) {
    const bottom = MONO_COLS - 1;               // 0..8
    const left = bottom + MONO_ROWS - 2;        // 9..11
    const top = left + MONO_COLS;               // 12..20
    if (pos <= bottom) return { row: MONO_ROWS, col: MONO_COLS - pos };
    if (pos <= left) return { row: MONO_ROWS - (pos - bottom), col: 1 };
    if (pos <= top) return { row: 1, col: pos - left };
    return { row: 1 + (pos - top), col: MONO_COLS };
}

function isMonoGroupOwned(board, group, ownerId) {
    return board.filter(c => c.group === group).every(c => c.owner === ownerId);
}

function monoRent(board, cell) {
    if (cell.mortgaged) return 0;
    const ownedOfType = board.filter(c => c.type === cell.type && c.owner === cell.owner).length;
    if (cell.type === 'railroad') return 25 * 2 ** (ownedOfType - 1);
    if (cell.type === 'utility') return ownedOfType === 2 ? '10× dados' : '4× dados';
    if (cell.houses > 0) return cell.rents[cell.houses];
    return cell.owner && isMonoGroupOwned(board, cell.group, cell.owner) ? cell.rents[0] * 2 : cell.rents[0];
}

// Casa 3D (caja con techo a dos aguas) o hotel sobre la banda de color
function monoBuildings3d(houses) {
    const faces = '<i class="w-front"></i><i class="w-left"></i><i class="w-right"></i><i class="r-front"></i><i class="r-back"></i>';
    if (houses === MONO_HOTEL) return `<div class="house3d hotel">${faces}</div>`;
    return `<div class="house3d">${faces}</div>`.repeat(houses);
}

function monoBuildingIcons(houses) {
    if (houses === MONO_HOTEL) return '<span class="mono-house hotel"></span>';
    return '<span class="mono-house"></span>'.repeat(houses);
}

function monoSide(pos) {
    if (pos <= MONO_COLS - 1) return 'bottom';
    if (pos <= MONO_COLS + MONO_ROWS - 3) return 'left';
    if (pos <= 2 * MONO_COLS + MONO_ROWS - 3) return 'top';
    return 'right';
}

const MONO_TOKENS = {
    car: { emoji: '🚗', name: 'Auto' },
    plane: { emoji: '✈️', name: 'Avión' },
    dog: { emoji: '🐶', name: 'Perro' },
    hat: { emoji: '🎩', name: 'Sombrero' },
    ship: { emoji: '🚢', name: 'Barco' },
    boot: { emoji: '👢', name: 'Bota' },
    cat: { emoji: '🐱', name: 'Gato' },
    rocket: { emoji: '🚀', name: 'Cohete' },
};

// Ficha del jugador: la figura elegida sobre una base de su color
function monoPawn(player, extraClass = '') {
    const figure = (MONO_TOKENS[player.token] || MONO_TOKENS.car).emoji;
    const layers = Array.from({ length: 6 }, (_, i) => `<span class="token-layer" style="--i:${i}">${figure}</span>`).join('');
    return `<div class="mono-token ${extraClass}" style="--c:${player.color}" title="${escapeHtml(player.name)}">
        <div class="token-base"><i></i><i></i><i></i><i></i></div>
        <div class="token-stand"><div class="token-spin">${layers}</div></div>
    </div>`;
}

// ---- Animación del recorrido: las fichas saltan casilla por casilla ----
const MONO_HOP_MS = 260;
const MONO_JUMP_MS = 650;
const MONO_DICE_MS = 900;
const monoDisplayPos = {};      // posición que se muestra de cada ficha (puede ir atrasada respecto del servidor)
let monoLastMoveSeq = null;
let monoAnimTimer = null;

function renderMonopolyTokens(state, movingPid = null, effect = '') {
    monopolyBoard.querySelectorAll('.cell-tokens').forEach(el => { el.innerHTML = ''; });
    const currentPid = state.turnOrder[state.currentTurnIndex];
    for (const pid of state.turnOrder) {
        const p = state.players[pid];
        if (!p || p.eliminated) continue;
        const pos = monoDisplayPos[pid] ?? p.position;
        const jailed = p.inJail && pos === p.position && state.board[pos].type === 'jail';
        const slot = monopolyBoard.querySelector(`.mono-cell[data-pos="${pos}"] .cell-tokens${jailed ? '.jailed' : ':not(.jailed)'}`);
        if (!slot) continue;
        const active = state.status === 'PLAYING' && pid === currentPid && !movingPid;
        const cls = `${pid === myId ? 'mine' : ''} ${pid === movingPid ? effect : ''} ${active ? 'active' : ''}`;
        slot.insertAdjacentHTML('beforeend', monoPawn(p, cls));
    }
    if (MONO3D.active) {
        const list = [];
        for (const pid of state.turnOrder) {
            const p = state.players[pid];
            if (!p || p.eliminated) continue;
            const pos = monoDisplayPos[pid] ?? p.position;
            list.push({
                pid, kind: p.token, color: p.color, pos,
                jailed: p.inJail && pos === p.position && state.board[pos].type === 'jail',
                mine: pid === myId,
                active: state.status === 'PLAYING' && pid === currentPid && !movingPid,
            });
        }
        window.Mono3D.setTokens(list, { movingPid, effect });
    }
    // Resalta la casilla donde está (visualmente) el jugador de turno
    const currentPos = state.status === 'PLAYING' && state.players[currentPid] ? monoDisplayPos[currentPid] : -1;
    monopolyBoard.querySelectorAll('.mono-cell').forEach(el => {
        el.classList.toggle('current-pos', Number(el.dataset.pos) === currentPos);
    });
}

// Prepara la animación de los movimientos nuevos y devuelve cuánto dura (ms).
function planMonopolyMoves(state) {
    clearTimeout(monoAnimTimer);
    const len = state.board.length;
    // Con la pestaña en segundo plano el navegador frena los temporizadores: no se anima
    const isNew = !document.hidden && monoLastMoveSeq !== null && state.moveSeq !== monoLastMoveSeq;
    monoLastMoveSeq = state.moveSeq;

    const steps = [];
    const movers = new Set();
    if (isNew) {
        for (const mv of state.moves || []) {
            if (!state.players[mv.playerId] || monoDisplayPos[mv.playerId] === undefined) continue;
            if (!movers.has(mv.playerId)) {
                movers.add(mv.playerId);
                monoDisplayPos[mv.playerId] = mv.from;
            }
            if (mv.walk) {
                for (let p = mv.from; p !== mv.to;) {
                    p = (p + 1) % len;
                    steps.push({ pid: mv.playerId, pos: p, jump: false });
                }
            } else {
                steps.push({ pid: mv.playerId, pos: mv.to, jump: true });
            }
        }
    }
    for (const pid in state.players) {
        if (!movers.has(pid)) monoDisplayPos[pid] = state.players[pid].position;
    }
    if (!steps.length) return 0;

    let i = 0;
    const next = () => {
        if (i >= steps.length) return;
        const st = steps[i++];
        monoDisplayPos[st.pid] = st.pos;
        renderMonopolyTokens(lastMonoState, st.pid, st.jump ? 'jump' : 'hop');
        monoAnimTimer = setTimeout(next, st.jump ? MONO_JUMP_MS : MONO_HOP_MS);
    };
    monoAnimTimer = setTimeout(next, MONO_DICE_MS);
    return MONO_DICE_MS + steps.reduce((t, st) => t + (st.jump ? MONO_JUMP_MS : MONO_HOP_MS), 0);
}

// Nivel visual según el precio: 1 humilde … 4 lujo
function monoTier(price) {
    if (price >= 350) return 4;
    if (price >= 220) return 3;
    if (price >= 140) return 2;
    return 1;
}

const MONO_TYPE_ICONS = { railroad: '🚂', chest: '🧰' };
const MONO_UTILITY_ICONS = { 12: '💡', 28: '🚰' };

const MONO_PROPERTY_ICONS = {
    1: '🏚️', 3: '🧱', 6: '🛣️', 8: '🌳', 9: '⛲', 11: '🏬', 13: '🖼️', 14: '🛍️',
    16: '🧺', 18: '🎭', 19: '🏛️', 21: '🌆', 23: '🌊', 24: '🏝️', 26: '⛵', 27: '🎰',
    29: '⛳', 31: '🏳️', 32: '📈', 34: '🏙️', 37: '🏰', 39: '👑',
};

const CORNER_CONTENT = {
    go: `<div class="corner-arrow">⬅</div><div class="corner-title red">SALIDA</div><div class="corner-sub">Cobra $${MONO_GO_SALARY} al pasar</div>`,
    jail: '<div class="jail-box"><div class="jail-bars"></div><span>EN LA CÁRCEL</span></div><div class="jail-visit"><b>SOLO DE</b><b>VISITA</b></div>',
    parking: '<div class="corner-title red">PARKING</div><div class="corner-icon big">🚗</div><div class="corner-title red">GRATIS</div>',
    goToJail: '<div class="corner-title">VAYA A LA</div><div class="corner-icon big">👮</div><div class="corner-title red">CÁRCEL</div>',
};

function renderMonopolyBoard(state) {
    monopolyBoard.querySelectorAll('.mono-cell').forEach(el => el.remove());
    const currentPid = state.turnOrder[state.currentTurnIndex];

    state.board.forEach((space, pos) => {
        const { row, col } = monoGridPosition(pos);
        const cell = document.createElement('div');
        cell.className = `mono-cell side-${monoSide(pos)} type-${space.type}`;
        if (space.type === 'property') cell.classList.add(`tier-${monoTier(space.price)}`);
        cell.style.gridRow = row;
        cell.style.gridColumn = col;
        cell.dataset.pos = pos;

        let body = '';
        let buildings = '';
        if (CORNER_CONTENT[space.type]) {
            cell.classList.add('corner');
            body = CORNER_CONTENT[space.type];
        } else if (MONO_OWNABLE.includes(space.type)) {
            const owner = space.owner ? state.players[space.owner] : null;
            const icon = space.type === 'railroad' ? MONO_TYPE_ICONS.railroad
                : space.type === 'utility' ? MONO_UTILITY_ICONS[space.id] : (MONO_PROPERTY_ICONS[space.id] || '');
            body = `
                ${space.type === 'property' ? `<div class="cell-color-bar group-${space.group}"></div>` : ''}
                <div class="cell-name">${escapeHtml(space.name)}</div>
                <div class="cell-icon">${icon}</div>
                <div class="cell-price">${owner ? (space.mortgaged ? 'Hipotecada' : `Renta $${monoRent(state.board, space)}`) : `$${space.price}`}</div>
                ${space.mortgaged ? '<div class="mortgage-stamp">HIPOTECADA</div>' : ''}
            `;
            buildings = space.houses > 0 ? `<div class="cell-houses">${monoBuildings3d(space.houses)}</div>` : '';
            if (owner) {
                cell.classList.add('owned');
                if (space.mortgaged) cell.classList.add('mortgaged');
                cell.style.setProperty('--owner', owner.color);
                cell.title = `${space.name} — dueño: ${owner.name}\nRenta actual: $${monoRent(state.board, space)}`;
            } else {
                cell.title = `${space.name} — $${space.price}`;
            }
        } else if (space.type === 'chance') {
            body = '<div class="chance-mark">?</div><div class="cell-name">SUERTE</div>';
        } else if (space.type === 'chest') {
            body = '<div class="cell-name">ARCA COMUNAL</div><div class="chest-mark">🧰</div>';
        } else if (space.type === 'tax') {
            body = `<div class="cell-name">${escapeHtml(space.name)}</div><div class="tax-icon">${space.amount <= 100 ? '💍' : '💰'}</div><div class="cell-price">Paga $${space.amount}</div>`;
        }

        const jailSlot = space.type === 'jail' ? '<div class="cell-tokens jailed"></div>' : '';
        cell.innerHTML = `<div class="cell-inner">${body}</div>${buildings}<div class="cell-tokens"></div>${jailSlot}`;
        monopolyBoard.appendChild(cell);
    });

    if (MONO3D.active) window.Mono3D.setBoard(state);
    renderMonopolyTokens(state);
    updateMonopolyDice(state);

    const cp = state.players[currentPid];
    if (state.status === 'PLAYING' && cp) {
        monopolyCurrentPlayer.innerHTML = currentPid === myId
            ? '<strong>¡ES TU TURNO!</strong>'
            : `Turno de <strong style="color:${cp.color}">${escapeHtml(cp.name)}</strong>`;
    } else if (state.status === 'FINISHED') {
        monopolyCurrentPlayer.innerText = 'Partida terminada';
    } else {
        const count = Object.keys(state.players).length;
        monopolyCurrentPlayer.innerText = count < 2 ? 'Se necesitan al menos 2 jugadores' : `${count} jugadores listos`;
    }
}

// ---- Dados 3D: cada dado es un cubo CSS; se gira para mostrar la cara que salió ----
const PIP_LAYOUT = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
// Rotación del cubo (x, y) que deja cada cara mirando al frente.
const DIE_FACE_ROTATION = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const monoDice = [document.getElementById('mono-die-1'), document.getElementById('mono-die-2')];
monoDice.forEach(die => {
    // Caras: 1 frente, 6 atrás, 3 derecha, 4 izquierda, 2 arriba, 5 abajo.
    die.innerHTML = [1, 6, 3, 4, 2, 5].map(v => `
        <div class="die-face face-${v}">
            ${Array.from({ length: 9 }, (_, i) => `<span class="${PIP_LAYOUT[v].includes(i + 1) ? 'pip' : ''}"></span>`).join('')}
        </div>`).join('');
});

let lastRollId = null;
function updateMonopolyDice(state) {
    const values = state.lastDice[0] > 0 ? state.lastDice : [5, 3];
    const animate = lastRollId !== null && state.rollId !== lastRollId;
    if (MONO3D.active) window.Mono3D.rollDice(values, animate && !document.hidden);
    monoDice.forEach((die, i) => {
        // Los dados están apoyados en el tablero: la cara "frontal" del cubo es la de arriba.
        const [fx, fy] = DIE_FACE_ROTATION[values[i]];
        const roll = state.rollId || 0;
        const spins = roll * 3 + i;                           // vueltas extra mientras vuelan
        const yaw = ((roll * 37 + i * 53) % 50) - 25;         // cada tirada queda un poco girada
        die.style.transition = animate ? '' : 'none';
        die.style.transform = `rotateZ(${yaw}deg) rotateX(${spins * 360 + fx}deg) rotateY(${spins * 360 + fy}deg)`;
        const slot = die.closest('.die-slot');
        slot.classList.remove('thrown');
        if (animate) {
            void slot.offsetWidth;   // reinicia la animación del lanzamiento
            slot.classList.add('thrown');
        }
    });
    lastRollId = state.rollId;
}

let lastCardRollId = null;
function updateMonopolyCard(state) {
    if (!state.currentCard) {
        monopolyCard.classList.add('hidden');
        lastCardRollId = null;
        return;
    }
    monopolyCard.classList.toggle('chest', state.currentCard.deck === 'chest');
    monopolyCard.innerHTML = `<div class="chance-card-header">${state.currentCard.deck === 'chest' ? 'ARCA COMUNAL' : 'SUERTE'}</div><div class="chance-card-text">${escapeHtml(state.currentCard.text)}</div>`;
    monopolyCard.classList.remove('hidden');
    if (lastCardRollId !== state.rollId) {
        monopolyCard.classList.remove('flip-in');
        void monopolyCard.offsetWidth;   // reinicia la animación
        monopolyCard.classList.add('flip-in');
        lastCardRollId = state.rollId;
        if (MONO3D.active) window.Mono3D.drawCard(state.currentCard.deck);
    }
}

// Cuenta regresiva del turno; el servidor reinicia el plazo en cada actualización.
let monoTimerInterval = null;
function startMonopolyTimer(state) {
    clearInterval(monoTimerInterval);
    monopolyTimer.innerText = '';
    if (state.status !== 'PLAYING') return;
    const deadline = Date.now() + state.turnSeconds * 1000;
    const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        monopolyTimer.innerText = `⏱ ${left}s`;
        monopolyTimer.classList.toggle('urgent', left <= 10);
        if (left === 0) clearInterval(monoTimerInterval);
    };
    tick();
    monoTimerInterval = setInterval(tick, 1000);
}

function renderMonopolyPlayers(state) {
    monopolyPlayersPanel.innerHTML = '';
    const turnPid = state.turnOrder[state.currentTurnIndex];
    // Primero los que juegan (en orden de turno), después los espectadores.
    const ordered = [...state.turnOrder, ...Object.keys(state.players).filter(id => !state.turnOrder.includes(id))];

    for (const pid of ordered) {
        const p = state.players[pid];
        if (!p) continue;
        const isSpectator = state.status !== 'WAITING' && !state.turnOrder.includes(pid);
        const div = document.createElement('div');
        div.dataset.pid = pid;
        div.className = 'mono-player-info'
            + (p.eliminated ? ' eliminated' : '')
            + (pid === turnPid && state.status === 'PLAYING' ? ' current-turn' : '');
        let tags = '';
        if (p.inJail) tags += '<span title="En la cárcel">🔒</span>';
        if (p.jailCards > 0) tags += `<span class="mono-tag" title="Carta Sal libre de la cárcel">🎟️ x${p.jailCards}</span>`;
        if (isSpectator) tags += '<span class="mono-tag">espectador</span>';
        if (p.eliminated) tags += '<span class="mono-tag">bancarrota</span>';
        // Una fichita del color del grupo por cada propiedad (con sus casas)
        const chips = [...p.properties].sort((a, b) => a - b).map(propId => {
            const prop = state.board[propId];
            const label = prop.houses === MONO_HOTEL ? 'H' : (prop.houses || '');
            return `<span class="prop-chip group-${prop.group}${prop.mortgaged ? ' mortgaged' : ''}" title="${escapeHtml(prop.name)}${prop.mortgaged ? ' (hipotecada)' : ''}">${label}</span>`;
        }).join('');
        div.innerHTML = `
            ${monoPawn(p, 'flat')}
            <span>${escapeHtml(p.name)}${pid === myId ? ' (Tú)' : ''}</span>
            <span class="mono-balance">$${p.balance}</span>
            <span class="prop-chips">${chips || '<span class="mono-props">sin propiedades</span>'}</span>
            ${tags}
        `;
        monopolyPlayersPanel.appendChild(div);
        if (pid === myId) monopolyMyBalance.innerText = p.balance;
    }
}

// ---- Tarjetas de "Título de Propiedad" ----
function isMyMonopolyTurn(state) {
    const me = state.players[myId];
    return !!me && state.status === 'PLAYING' && !me.eliminated && state.turnOrder[state.currentTurnIndex] === myId;
}

// Acciones posibles sobre una propiedad propia, con las mismas reglas que valida el servidor
function deedActions(state, prop) {
    if (!isMyMonopolyTurn(state) || prop.owner !== myId) return [];
    const me = state.players[myId];
    const group = state.board.filter(c => c.group === prop.group);
    const minH = Math.min(...group.map(c => c.houses));
    const maxH = Math.max(...group.map(c => c.houses));
    const actions = [];
    if (prop.type === 'property' && (state.phase === 'ROLL' || state.phase === 'END_TURN') && prop.houses < MONO_HOTEL
        && isMonoGroupOwned(state.board, prop.group, myId) && !group.some(c => c.mortgaged)
        && prop.houses === minH && me.balance >= prop.houseCost) {
        actions.push(['buyHouse', prop.houses === 4 ? `🏨 + Hotel ($${prop.houseCost})` : `🏠 + Casa ($${prop.houseCost})`, 'build']);
    }
    if (prop.houses > 0 && prop.houses === maxH) {
        actions.push(['sellHouse', `Vender (+$${prop.houseCost / 2})`, 'sell']);
    }
    if (!prop.mortgaged && maxH === 0) {
        actions.push(['mortgage', `Hipotecar (+$${prop.price / 2})`, 'mortgage']);
    }
    const unmortgageCost = Math.ceil(prop.price / 2 * 1.1);
    if (prop.mortgaged && me.balance >= unmortgageCost) {
        actions.push(['unmortgage', `Levantar hipoteca (-$${unmortgageCost})`, 'unmortgage']);
    }
    return actions;
}

function renderDeedCard(prop, state, { large = false, actions = [] } = {}) {
    const owner = prop.owner ? state.players[prop.owner] : null;
    const fullGroup = owner && isMonoGroupOwned(state.board, prop.group, prop.owner);
    const ownedOfType = owner ? state.board.filter(c => c.type === prop.type && c.owner === prop.owner).length : 0;
    const rows = prop.type === 'railroad' ? [
        ['Con 1 estación', 25, ownedOfType === 1], ['Con 2 estaciones', 50, ownedOfType === 2],
        ['Con 3 estaciones', 100, ownedOfType === 3], ['Con 4 estaciones', 200, ownedOfType === 4],
    ] : prop.type === 'utility' ? [
        ['Con 1 servicio', '4× dados', ownedOfType === 1], ['Con los 2', '10× dados', ownedOfType === 2],
    ] : [
        ['Renta', prop.rents[0], prop.houses === 0 && !fullGroup],
        ['Con grupo completo', prop.rents[0] * 2, prop.houses === 0 && fullGroup],
        ['Con 1 casa', prop.rents[1], prop.houses === 1],
        ['Con 2 casas', prop.rents[2], prop.houses === 2],
        ['Con 3 casas', prop.rents[3], prop.houses === 3],
        ['Con 4 casas', prop.rents[4], prop.houses === 4],
        ['Con hotel', prop.rents[5], prop.houses === MONO_HOTEL],
    ];
    return `
        <div class="deed-card${large ? ' large' : ''}${fullGroup ? ' full-group' : ''}${prop.mortgaged ? ' mortgaged' : ''}">
            <div class="deed-header group-${prop.group}">
                <small>${prop.type === 'property' ? 'TÍTULO DE PROPIEDAD' : prop.type === 'railroad' ? '🚂 ESTACIÓN' : '⚡ SERVICIO'}</small>
                <div class="deed-name">${escapeHtml(prop.name)}</div>
            </div>
            <div class="deed-houses">${monoBuildingIcons(prop.houses) || '&nbsp;'}</div>
            <table class="deed-rents">
                ${rows.map(([label, value, current]) => `<tr class="${current && !prop.mortgaged ? 'current' : ''}"><td>${label}</td><td>${typeof value === 'number' ? '$' + value : value}</td></tr>`).join('')}
            </table>
            <div class="deed-footer">
                <span>${prop.houseCost ? `Casa/Hotel: $${prop.houseCost}` : `Valor: $${prop.price}`}</span>
                <span>Hipoteca: $${prop.price / 2}</span>
            </div>
            ${owner ? `<div class="deed-owner" style="--owner:${owner.color}">${escapeHtml(owner.name)}${fullGroup ? ' · Grupo completo ✓' : ''}</div>` : `<div class="deed-owner free">Disponible · $${prop.price}</div>`}
            ${prop.mortgaged ? '<div class="deed-stamp">HIPOTECADA</div>' : ''}
            ${actions.map(([action, label, kind]) => `<button class="deed-btn ${kind}" data-deed-action="${action}" data-prop="${prop.id}">${label}</button>`).join('')}
        </div>`;
}

function renderMonopolyHand(state) {
    const me = state.players[myId];
    if (!me || me.properties.length === 0) {
        monoHand.innerHTML = me && state.status === 'PLAYING'
            ? '<div class="hand-empty">Tus tarjetas de propiedad aparecerán aquí</div>' : '';
        return;
    }
    let prevGroup = null;
    monoHand.innerHTML = [...me.properties].sort((a, b) => a - b).map(propId => {
        const prop = state.board[propId];
        const newGroup = prevGroup !== null && prevGroup !== prop.group;
        prevGroup = prop.group;
        return `<div class="hand-slot${newGroup ? ' group-gap' : ''}">${renderDeedCard(prop, state, { actions: deedActions(state, prop) })}</div>`;
    }).join('');
}

// Selector de ficha (solo antes de empezar la partida)
const monoTokenPicker = document.getElementById('mono-token-picker');
monoTokenPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-token]');
    if (btn && !btn.disabled) socket.emit('setMonopolyToken', btn.dataset.token);
});

function renderTokenPicker(state) {
    const me = state.players[myId];
    const visible = !!me && state.status !== 'PLAYING';
    monoTokenPicker.classList.toggle('hidden', !visible);
    if (!visible) return;
    monoTokenPicker.innerHTML = '<span class="picker-label">Elige tu ficha:</span>' +
        Object.entries(MONO_TOKENS).map(([key, t]) => {
            const takenBy = Object.values(state.players).find(p => p.token === key && p.id !== myId);
            const title = takenBy ? `${t.name} (la tiene ${takenBy.name})` : t.name;
            return `<button class="token-option${me.token === key ? ' selected' : ''}" data-token="${key}"
                ${takenBy ? 'disabled' : ''} title="${escapeHtml(title)}">${t.emoji}</button>`;
        }).join('');
}

function renderMonopolyControls(state) {
    [monopolyControls, monoStartBtn, monoRollBtn, monoBuyBtn,
        monoSkipBtn, monoEndBtn, monoPayJailBtn, monoJailCardBtn].forEach(el => el.classList.add('hidden'));

    const me = state.players[myId];
    if (!me) return;
    const show = (...els) => els.forEach(el => el.classList.remove('hidden'));

    if (state.status !== 'PLAYING') {
        if (Object.keys(state.players).length >= 2) {
            monoStartBtn.innerText = state.status === 'FINISHED' ? '🔄 Nueva Partida' : '🎮 Iniciar Juego';
            show(monopolyControls, monoStartBtn);
        }
        return;
    }

    if (state.turnOrder[state.currentTurnIndex] !== myId || me.eliminated) return;
    show(monopolyControls);

    if (state.phase === 'ROLL') {
        monoRollBtn.innerText = me.inJail ? '🎲 Tirar (Dobles = Libre)' : '🎲 Tirar Dados';
        show(monoRollBtn);
        if (me.inJail) {
            show(monoPayJailBtn);
            monoPayJailBtn.disabled = me.balance < MONO_JAIL_FINE;
            if (me.jailCards > 0) show(monoJailCardBtn);
        }
    } else if (state.phase === 'BUYING') {
        const space = state.board[me.position];
        monoBuyBtn.innerText = me.balance >= space.price
            ? `Comprar ${space.name} ($${space.price})`
            : `Te faltan $${space.price - me.balance}: hipoteca para comprar`;
        monoBuyBtn.disabled = me.balance < space.price;
        show(monoBuyBtn, monoSkipBtn);
    } else if (state.phase === 'END_TURN') {
        show(monoEndBtn);
    }
}

// ---- Efectos visuales al caer en casillas especiales ----
const monoFx = document.getElementById('mono-fx');
let monoLastEventSeq = null;

function fxPlayerName(state, pid) {
    return escapeHtml(state.players[pid]?.name || 'Alguien');
}

// Describe cómo se ve cada evento. tone: good | bad | jail | neutral | dark | gold
const MONO_FX = {
    tax: (e, st) => ({ icon: '💸', title: e.name.toUpperCase(), sub: `${fxPlayerName(st, e.playerId)} paga $${e.amount} al banco`, tone: 'bad', amount: -e.amount, coins: 'bank' }),
    rent: (e, st) => ({ icon: '🏠', title: 'RENTA', sub: `${fxPlayerName(st, e.playerId)} paga $${e.amount} a ${fxPlayerName(st, e.ownerId)}`, tone: 'bad', amount: -e.amount, coins: e.ownerId }),
    go: (e) => ({ icon: '💰', title: '¡SALIDA!', sub: `Cobra $${e.amount}`, tone: 'good', amount: e.amount, sparkle: true }),
    jail: (e, st) => ({ icon: '🚔', title: '¡A LA CÁRCEL!', sub: e.reason === 'triple' ? 'Tres dobles seguidos' : fxPlayerName(st, e.playerId), tone: 'jail', siren: true }),
    visit: () => ({ icon: '👋', title: 'Solo de visita', tone: 'neutral', small: true }),
    parking: () => ({ icon: '🅿️', title: 'Parking gratis', sub: 'Un respiro...', tone: 'neutral', small: true }),
    mortgagedLand: () => ({ icon: '📄', title: 'Hipotecada', sub: 'No se paga renta', tone: 'neutral', small: true }),
    money: (e) => ({ amount: e.amount, silent: true }),
    jailFree: () => ({ icon: '🎟️', title: '¡Sal libre de la cárcel!', sub: 'Guardas la carta', tone: 'good', small: true }),
    doubles: () => ({ icon: '🎲', title: '¡DOBLES!', sub: 'Tira otra vez', tone: 'good', small: true }),
    freed: () => ({ icon: '🔓', title: '¡Libre!', sub: 'Dobles en la cárcel', tone: 'good', small: true }),
    buy: (e, st) => ({ icon: '🔑', title: '¡COMPRADA!', sub: escapeHtml(st.board[e.cellId].name), tone: 'good', small: true, stamp: 'COMPRADA' }),
    build: (e, st) => ({ icon: e.hotel ? '🏨' : '🔨', title: e.hotel ? '¡HOTEL!' : 'Casa construida', sub: escapeHtml(st.board[e.cellId].name), tone: 'good', small: true }),
    bankrupt: (e, st) => ({ icon: '💀', title: 'BANCARROTA', sub: fxPlayerName(st, e.playerId), tone: 'dark' }),
    win: (e, st) => ({ icon: '🏆', title: `¡${fxPlayerName(st, e.playerId)} GANA!`, sub: 'Fin de la partida', tone: 'gold', confetti: true, long: true }),
};

function fxCenterOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function fxCellFor(state, e) {
    const pos = e.cellId ?? state.players[e.playerId]?.position;
    return pos === undefined ? null : monopolyBoard.querySelector(`.mono-cell[data-pos="${pos}"]`);
}

function fxSpawn(html, className, x, y, lifeMs) {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    monoFx.appendChild(el);
    setTimeout(() => el.remove(), lifeMs);
    return el;
}

function fxFloatAmount(point, amount) {
    if (!point || !amount) return;
    const text = amount > 0 ? `+$${amount}` : `-$${-amount}`;
    fxSpawn(text, `fx-float ${amount > 0 ? 'good' : 'bad'}`, point.x, point.y, 1600);
}

function fxCoins(from, to, count = 7) {
    if (!from || !to) return;
    for (let i = 0; i < count; i++) {
        const coin = fxSpawn('🪙', 'fx-coin', from.x + (Math.random() - 0.5) * 30, from.y + (Math.random() - 0.5) * 20, 1400);
        coin.style.setProperty('--dx', `${to.x - from.x}px`);
        coin.style.setProperty('--dy', `${to.y - from.y}px`);
        coin.style.animationDelay = `${i * 70}ms`;
    }
}

function fxSparkle(point) {
    if (!point) return;
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const sp = fxSpawn('✨', 'fx-sparkle', point.x, point.y, 1000);
        sp.style.setProperty('--dx', `${Math.cos(angle) * 70}px`);
        sp.style.setProperty('--dy', `${Math.sin(angle) * 50}px`);
    }
}

function fxConfetti() {
    const colors = ['#d2202f', '#ffbe00', '#1f9d4c', '#0072bb', '#f7941d', '#d93a96'];
    for (let i = 0; i < 90; i++) {
        const c = fxSpawn('', 'fx-confetti', Math.random() * window.innerWidth, -20, 3200);
        c.style.background = colors[i % colors.length];
        c.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
        c.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
        c.style.animationDelay = `${Math.random() * 700}ms`;
        c.style.animationDuration = `${2 + Math.random()}s`;
    }
}

function fxFlashCell(cell, tone) {
    if (!cell) return;
    cell.classList.add('fx-hit', `fx-${tone}`);
    setTimeout(() => cell.classList.remove('fx-hit', `fx-${tone}`), 1300);
}

function fxBanner(fx) {
    const el = fxSpawn(`
        <div class="fx-icon">${fx.icon}</div>
        <div class="fx-title">${fx.title}</div>
        ${fx.sub ? `<div class="fx-sub">${fx.sub}</div>` : ''}`,
        `fx-banner tone-${fx.tone}${fx.small ? ' small' : ''}`,
        window.innerWidth / 2, window.innerHeight * 0.2, fx.long ? 3200 : fx.small ? 1300 : 1900);
    if (fx.siren) {
        monopolyScreen.classList.add('fx-siren');
        setTimeout(() => monopolyScreen.classList.remove('fx-siren'), 1800);
    }
    return el;
}

const FX_TONE_COLORS = { good: '#22c55e', bad: '#ef4444', jail: '#3b82f6', neutral: '#94a3b8', dark: '#111111', gold: '#ffbe00' };

// Reproduce los eventos de la jugada, uno detrás de otro
function playMonopolyEvents(state, events) {
    let delay = 0;
    for (const e of events) {
        const def = MONO_FX[e.type];
        if (!def) continue;
        const fx = def(e, state);
        setTimeout(() => {
            const cell = fxCellFor(state, e);
            const tone = fx.tone || (fx.amount > 0 ? 'good' : 'bad');
            const cellPos = e.cellId ?? state.players[e.playerId]?.position;
            const point = MONO3D.active && cellPos !== undefined ? window.Mono3D.cellScreenPoint(cellPos) : fxCenterOf(cell);
            if (!fx.silent) fxBanner(fx);
            if (MONO3D.active) { if (cellPos !== undefined) window.Mono3D.flashCell(cellPos, FX_TONE_COLORS[tone]); }
            else fxFlashCell(cell, tone);
            fxFloatAmount(point, fx.amount);
            if (fx.coins === 'bank') fxCoins(point, { x: window.innerWidth / 2, y: -40 });
            else if (fx.coins) fxCoins(point, fxCenterOf(monopolyPlayersPanel.querySelector(`[data-pid="${fx.coins}"]`)));
            if (fx.sparkle) fxSparkle(point);
            if (fx.confetti) fxConfetti();
            if (fx.stamp && point) fxSpawn(fx.stamp, 'fx-stamp', point.x, point.y, 1400);
        }, delay);
        delay += fx.silent ? 250 : fx.small ? 900 : 1400;
    }
}

// El mensaje, la carta, los saldos y los botones se muestran cuando la ficha termina de moverse;
// en ese momento se reproducen los efectos de la casilla.
let monoRevealTimer = null;
let monoPendingReveal = null;
// Al volver a la pestaña, muestra de inmediato lo que quedó pendiente (botones incluidos)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && monoPendingReveal) {
        clearTimeout(monoRevealTimer);
        clearTimeout(monoAnimTimer);
        if (lastMonoState) {
            for (const pid in lastMonoState.players) monoDisplayPos[pid] = lastMonoState.players[pid].position;
            renderMonopolyTokens(lastMonoState);
        }
        monoPendingReveal();
    }
});
function revealMonopolyOutcome(state, events) {
    monopolyMessage.innerText = state.message || 'Esperando jugadores...';
    renderMonopolyPlayers(state);
    renderMonopolyHand(state);
    updateMonopolyCard(state);
    renderMonopolyControls(state);
    if (events.length) playMonopolyEvents(state, events);
}

socket.on('monopolyGameState', (state) => {
    lastMonoState = state;
    const events = monoLastEventSeq !== null && state.eventSeq !== monoLastEventSeq ? state.events : [];
    monoLastEventSeq = state.eventSeq;
    const animMs = planMonopolyMoves(state);
    try {
        renderMonopolyBoard(state);
    } catch(e) {
        console.error('Error rendering monopoly:', e);
    }
    renderTokenPicker(state);

    clearTimeout(monoRevealTimer);
    monoPendingReveal = null;
    if (animMs > 0) {
        monopolyControls.classList.add('hidden');
        monopolyCard.classList.add('hidden');
        monopolyMessage.innerText = '🎲 ...';
        monoPendingReveal = () => { monoPendingReveal = null; revealMonopolyOutcome(state, events); };
        monoRevealTimer = setTimeout(monoPendingReveal, animMs);
    } else {
        revealMonopolyOutcome(state, document.hidden ? [] : events);
    }
    startMonopolyTimer(state);
});


// ---- Cámara del Monopoly: vistas predefinidas + parallax suave con el mouse ----
const MONO_VIEWS = [
    { name: '🎥 Vista 3D', tilt: 32 },
    { name: '🎥 Vista baja', tilt: 52 },
    { name: '🎥 Vista superior', tilt: 12 },
];
const monoCameraBtn = document.getElementById('mono-camera-btn');
const monoStage = document.querySelector('.monopoly-stage');
let monoViewIdx = 0;
function applyMonopolyView() {
    const view = MONO_VIEWS[monoViewIdx];
    monopolyScreen.style.setProperty('--tilt', view.tilt + 'deg');
    monoCameraBtn.textContent = view.name;
    if (window.Mono3D) window.Mono3D.setView(monoViewIdx);
}
monoCameraBtn.addEventListener('click', () => {
    monoViewIdx = (monoViewIdx + 1) % MONO_VIEWS.length;
    applyMonopolyView();
    try { localStorage.setItem('mono.view', monoViewIdx); } catch (e) { /* sin almacenamiento */ }
});
try { monoViewIdx = Number(localStorage.getItem('mono.view')) % MONO_VIEWS.length || 0; } catch (e) { /* sin almacenamiento */ }
applyMonopolyView();

let monoParallaxFrame = null;
monoStage.addEventListener('mousemove', (e) => {
    if (monoParallaxFrame || MONO3D.active) return;
    monoParallaxFrame = requestAnimationFrame(() => {
        monoParallaxFrame = null;
        const r = monoStage.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        monopolyBoard.style.setProperty('--cam-z', (nx * 4).toFixed(2) + 'deg');
        monopolyBoard.style.setProperty('--cam-x', (ny * -3).toFixed(2) + 'deg');
    });
});
monoStage.addEventListener('mouseleave', () => {
    monopolyBoard.style.setProperty('--cam-z', '0deg');
    monopolyBoard.style.setProperty('--cam-x', '0deg');
});

// ---- Tablero 3D (WebGL): se activa si public/mono3d/index.js publicó window.Mono3D ----
// Con ?no3d=1 en la URL se usa siempre el tablero HTML de respaldo.
const MONO3D = { active: false };
const monoCenter = document.querySelector('.monopoly-center');

function tryActivateMono3D() {
    if (MONO3D.active || !window.Mono3D || new URLSearchParams(location.search).has('no3d')) return;
    if (monopolyScreen.classList.contains('hidden')) return;
    window.Mono3D.setView(monoViewIdx);
    monopolyScreen.classList.add('mono-3d');
    monoStage.appendChild(monoCenter);          // los controles quedan como panel sobre la escena
    const hudWidth = monoCenter.offsetWidth + 24;
    if (!window.Mono3D.init(monoStage, { insets: { right: hudWidth } })) {
        monopolyScreen.classList.remove('mono-3d');
        monopolyBoard.appendChild(monoCenter);
        return;
    }
    MONO3D.active = true;
    window.Mono3D.onCellClick(openMonoDeed);
    if (lastMonoState) {
        renderMonopolyBoard(lastMonoState);
        window.Mono3D.rollDice(lastMonoState.lastDice[0] > 0 ? lastMonoState.lastDice : [5, 3], false);
    }
}
window.addEventListener('mono3d-ready', tryActivateMono3D);
btnMonopoly.addEventListener('click', () => setTimeout(tryActivateMono3D, 0));
tryActivateMono3D();
