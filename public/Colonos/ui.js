// Interfaz de "Colonos de la Isla". Usa el `socket` global creado en client.js.
import { createColonosBoard } from './board3d.js';

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const RES_INFO = {
    wood: { icon: '🌲', name: 'Madera' }, brick: { icon: '🧱', name: 'Ladrillo' }, sheep: { icon: '🐑', name: 'Lana' },
    wheat: { icon: '🌾', name: 'Trigo' }, ore: { icon: '⛰️', name: 'Mineral' },
};
const DEV_INFO = {
    knight: { icon: '⚔️', name: 'Caballero', help: 'Mueve al ladrón y roba una carta.' },
    victory: { icon: '⭐', name: 'Punto de victoria', help: 'Suma 1 punto (secreto).' },
    roadBuilding: { icon: '🛣️', name: 'Construcción de caminos', help: 'Construye 2 caminos gratis.' },
    yearOfPlenty: { icon: '🌾', name: 'Año de abundancia', help: 'Toma 2 recursos del banco.' },
    monopoly: { icon: '💰', name: 'Monopolio', help: 'Todos te dan un recurso.' },
};
const PHASE_HELP = {
    setupSettlement: 'Coloca tu pueblo inicial (puntos brillantes).',
    setupRoad: 'Coloca un camino junto a tu pueblo.',
    roll: 'Tira los dados (o juega un Caballero antes).',
    discard: 'Salió 7: quienes tienen más de 7 cartas descartan la mitad.',
    robber: 'Mueve al ladrón a otro hexágono.',
    steal: 'Elige a quién robarle una carta.',
    main: 'Construye, comercia o termina tu turno.',
    roadBuilding: 'Coloca tus caminos gratis.',
    specialBuild: 'Construcción especial: puedes construir o comprar una carta (sin comerciar), o pasar.',
};
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const screen = document.getElementById('colonos-screen');
const stageEl = document.getElementById('col-stage');
const sideEl = document.getElementById('col-side');
const handEl = document.getElementById('col-hand');
let board = null;
let state = null;
let mode = null;        // modo de construcción elegido: 'road' | 'settlement' | 'city'
let tradeDraft = { give: {}, get: {} };
let discardDraft = {};
let timerInterval = null;

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const act = (type, extra = {}) => socket.emit('colonosAction', { type, ...extra });
const costHtml = cost => RES.filter(r => cost[r]).map(r => `${RES_INFO[r].icon}${cost[r] > 1 ? '×' + cost[r] : ''}`).join(' ');
const canPay = (res, cost) => RES.every(r => (res[r] || 0) >= (cost[r] || 0));

document.getElementById('btn-colonos').addEventListener('click', () => {
    socket.emit('joinRoom', 'colonos');
    document.getElementById('lobby-screen').classList.add('hidden');
    screen.classList.remove('hidden');
    if (!board) {
        try {
            board = createColonosBoard(stageEl);
            board.onPick(onPick);
        } catch (err) {
            console.error(err);
            stageEl.innerHTML = '<div class="col-nogl">Tu navegador no puede mostrar la isla en 3D (WebGL). Prueba con Chrome o Edge actualizados.</div>';
        }
    }
    if (state) render();
});

function onPick(pick) {
    if (!state) return;
    if (pick.kind === 'vertex') {
        const isCity = mode === 'city';
        act(isCity ? 'placeCity' : 'placeSettlement', { v: pick.id });
    } else if (pick.kind === 'edge') {
        act('placeRoad', { e: pick.id });
    } else if (pick.kind === 'hex') {
        act('moveRobber', { hex: pick.id });
    }
    mode = null;
}

socket.on('colonosState', s => {
    const newTurn = !state || state.current !== s.current;
    state = s;
    if (newTurn) mode = null;
    if (!s.discardNeeded) discardDraft = {};
    render();
});

// ---------- Marcadores sobre la isla según la fase ----------
function updateMarkers() {
    if (!board) return;
    board.update(state);
    const L = state.legal;
    if (!L) return board.setMarkers(null, []);
    switch (state.phase) {
        case 'setupSettlement': return board.setMarkers('vertex', L.settlements);
        case 'setupRoad': case 'roadBuilding': return board.setMarkers('edge', L.roads);
        case 'robber': return board.setMarkers('hex', state.board.hexes.filter(h => h.id !== state.robber).map(h => h.id));
        case 'main': case 'specialBuild':
            if (mode === 'road') return board.setMarkers('edge', L.roads);
            if (mode === 'settlement') return board.setMarkers('vertex', L.settlements);
            if (mode === 'city') return board.setMarkers('vertex', L.cities);
            return board.setMarkers(null, []);
        default: return board.setMarkers(null, []);
    }
}

// ---------- Panel lateral ----------
function render() {
    if (screen.classList.contains('hidden')) return;
    updateMarkers();
    const me = state.players[state.me];
    const isTurn = state.current === state.me && state.status === 'PLAYING';
    const cur = state.players[state.current];
    let html = '';

    if (state.status !== 'PLAYING') {
        const n = state.order.length;
        html += `<div class="col-card"><div class="col-title2">🏝️ Colonos de la Isla</div>`;
        if (state.status === 'FINISHED' && state.winner) html += `<div class="col-win">🏆 ¡Ganó ${esc(state.players[state.winner]?.name)}!</div>`;
        const big = !!state.options?.big;
        html += `<label class="col-option"><input type="checkbox" data-opt="big" ${big ? 'checked' : ''} ${me ? '' : 'disabled'}>
            <span><b>Expansión 5-6 jugadores</b><br><small>Isla de 30 hexágonos, 11 puertos, banco de 24 y construcción especial entre turnos.</small></span></label>`;
        html += `<p>${n} jugador${n === 1 ? '' : 'es'} en la mesa (2 a ${state.maxPlayers}). Gana quien llega a <b>10 puntos</b>.</p>`;
        if (n > state.maxPlayers) html += `<p class="col-warn">Hay más de 4 jugadores: activa la expansión 5-6 para empezar.</p>`;
        if (me && n >= 2 && n <= state.maxPlayers) html += `<button class="btn btn-primary col-wide" data-act="start">${state.status === 'FINISHED' ? '🔄 Nueva partida' : '🎮 Iniciar partida'}</button>`;
        else if (!me && n < 6) html += `<p>Estás mirando.</p><button class="btn btn-success col-wide" data-act="sit">🪑 Sentarme a jugar</button>`;
        else if (!me) html += `<p>La mesa está llena: estás mirando.</p>`;
        else html += `<p>Esperando a otro jugador…</p>`;
        html += `</div>`;
    } else {
        html += `<div class="col-card col-turn">
            <div class="col-row"><span>${isTurn ? '<b>¡Es tu turno!</b>' : `Turno de <b style="color:${cur?.color}">${esc(cur?.name)}</b>`}</span><span class="col-timer" id="col-timer"></span></div>
            <div class="col-help">${PHASE_HELP[state.phase] || ''}</div>
            <div class="col-mode">${state.options?.big ? '➕ Con expansión 5-6 jugadores' : '🏝️ Juego base'}</div>
            <div class="col-dice" data-roll="${state.rollId}">${state.dice[0] ? DICE[state.dice[0]] + DICE[state.dice[1]] : '🎲🎲'}${state.dice[0] ? `<small>${state.dice[0] + state.dice[1]}</small>` : ''}</div>
        </div>`;

        // Descartes (cualquier jugador)
        if (state.discardNeeded && me) {
            const chosen = RES.reduce((s, r) => s + (discardDraft[r] || 0), 0);
            html += `<div class="col-card col-alert"><b>Descarta ${state.discardNeeded} cartas</b> (${chosen}/${state.discardNeeded})<div class="col-counters">`;
            for (const r of RES) {
                html += `<div class="col-counter"><span>${RES_INFO[r].icon}</span><button data-disc="${r}" data-d="-1">−</button><b>${discardDraft[r] || 0}</b><button data-disc="${r}" data-d="1" ${(discardDraft[r] || 0) >= me.res[r] ? 'disabled' : ''}>+</button></div>`;
            }
            html += `</div><button class="btn btn-warning col-wide" data-act="discard" ${chosen !== state.discardNeeded ? 'disabled' : ''}>Descartar</button></div>`;
        } else if (state.phase === 'discard') {
            html += `<div class="col-card">Esperando que descarten: ${state.discardPending.map(id => esc(state.players[id]?.name)).join(', ')}</div>`;
        }

        if (isTurn && me) {
            if (state.phase === 'roll') html += `<button class="btn btn-primary col-wide col-big" data-act="roll">🎲 Tirar dados</button>`;
            if (state.phase === 'steal') {
                html += `<div class="col-card"><b>¿A quién le robas?</b>`;
                for (const id of state.stealFrom) html += `<button class="btn btn-danger col-wide" data-steal="${id}">🦹 ${esc(state.players[id].name)} (${state.players[id].cards} cartas)</button>`;
                html += `</div>`;
            }
            if (['main', 'roadBuilding', 'specialBuild'].includes(state.phase)) {
                if (state.phase === 'main' || state.phase === 'specialBuild') {
                    const L = state.legal;
                    const b = (key, label, cost, legal, extra = '') => {
                        const ok = canPay(me.res, cost) && legal && me.pieces[key] !== 0;
                        return `<button class="btn col-build ${mode === key ? 'active' : ''}" data-mode="${key}" ${ok ? '' : 'disabled'} title="Quedan ${me.pieces[key]}">${label}<small>${costHtml(cost)}</small>${extra}</button>`;
                    };
                    html += `<div class="col-card"><b>Construir</b><div class="col-grid">
                        ${b('road', '🛣️ Camino', state.costs.road, L.roads.length)}
                        ${b('settlement', '🏠 Pueblo', state.costs.settlement, L.settlements.length)}
                        ${b('city', '🏙️ Ciudad', state.costs.city, L.cities.length)}
                        <button class="btn col-build" data-act="buyDev" ${canPay(me.res, state.costs.dev) && state.devLeft ? '' : 'disabled'}>🃏 Carta<small>${costHtml(state.costs.dev)}</small></button>
                    </div>${mode ? '<div class="col-help">Elige un lugar brillante en la isla. <a href="#" data-mode="none">Cancelar</a></div>' : ''}</div>`;
                    if (state.phase === 'main') html += tradeHtml(me);
                } else {
                    html += `<div class="col-card col-alert">Caminos gratis: coloca ${state.freeRoads}.</div>`;
                }
                html += `<button class="btn btn-warning col-wide col-big" data-act="endTurn">${state.phase === 'specialBuild' ? '⏭️ Pasar' : '⏭️ Terminar turno'}</button>`;
            }
            html += devHtml(me);
        } else if (me && state.status === 'PLAYING') {
            html += offerForOthersHtml(me);
            html += devHtml(me);
        }
    }

    html += playersHtml();
    html += `<div class="col-card col-log">${state.log.slice(-7).map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
    sideEl.innerHTML = html;
    renderHand(me);
    startTimer();
}

function tradeHtml(me) {
    let html = `<div class="col-card"><b>Comerciar</b>`;
    // Banco / puertos
    html += `<div class="col-row col-bank">Banco:
        <select id="col-bank-give">${RES.map(r => `<option value="${r}" ${me.res[r] < me.rates[r] ? 'disabled' : ''}>${me.rates[r]} ${RES_INFO[r].icon}</option>`).join('')}</select>
        →
        <select id="col-bank-get">${RES.map(r => `<option value="${r}">1 ${RES_INFO[r].icon}</option>`).join('')}</select>
        <button class="btn btn-success btn-sm" data-act="bankTrade">Cambiar</button></div>`;
    // Oferta a jugadores
    if (state.trade && state.trade.from === state.me) {
        html += `<div class="col-offer">Tu oferta: das ${resList(state.trade.give)} y pides ${resList(state.trade.get)}
            <button class="btn btn-danger btn-sm" data-act="cancelTrade">Retirar</button></div>`;
    } else {
        html += `<div class="col-help">Oferta a los jugadores (das ↑ / pides ↓):</div><div class="col-counters">`;
        for (const r of RES) {
            html += `<div class="col-counter"><span>${RES_INFO[r].icon}</span>
                <button data-tr="give" data-r="${r}" data-d="1" ${(tradeDraft.give[r] || 0) >= me.res[r] ? 'disabled' : ''}>↑${tradeDraft.give[r] || 0}</button>
                <button data-tr="get" data-r="${r}" data-d="1">↓${tradeDraft.get[r] || 0}</button></div>`;
        }
        html += `</div><div class="col-row"><button class="btn btn-secondary btn-sm" data-act="clearTrade">Limpiar</button>
            <button class="btn btn-primary btn-sm" data-act="offerTrade">Ofrecer</button></div>`;
    }
    return html + `</div>`;
}

function offerForOthersHtml(me) {
    const t = state.trade;
    if (!t) return '';
    const from = state.players[t.from];
    const ok = canPay(me.res, t.get);
    return `<div class="col-card col-alert">🤝 <b>${esc(from?.name)}</b> ofrece ${resList(t.give)} a cambio de ${resList(t.get)}
        <button class="btn btn-success col-wide" data-accept="${t.id}" ${ok ? '' : 'disabled'}>${ok ? 'Aceptar' : 'No tienes lo que pide'}</button></div>`;
}

function devHtml(me) {
    if (!me.dev || !me.dev.length) return '';
    const isTurn = state.current === state.me;
    let html = `<div class="col-card"><b>Tus cartas de desarrollo</b>`;
    me.dev.forEach((d, i) => {
        const info = DEV_INFO[d.type];
        const canPlay = isTurn && d.type !== 'victory' && d.playable && !state.devPlayed
            && (state.phase === 'main' || (state.phase === 'roll' && d.type === 'knight'));
        html += `<div class="col-dev"><span title="${info.help}">${info.icon} ${info.name}</span>`;
        if (d.type === 'yearOfPlenty' && canPlay) {
            html += `<select id="col-yop1-${i}">${RES.map(r => `<option value="${r}">${RES_INFO[r].icon}</option>`).join('')}</select>
                     <select id="col-yop2-${i}">${RES.map(r => `<option value="${r}">${RES_INFO[r].icon}</option>`).join('')}</select>`;
        }
        if (d.type === 'monopoly' && canPlay) {
            html += `<select id="col-mono-${i}">${RES.map(r => `<option value="${r}">${RES_INFO[r].icon}</option>`).join('')}</select>`;
        }
        if (canPlay) html += `<button class="btn btn-success btn-sm" data-dev="${d.type}" data-i="${i}">Jugar</button>`;
        else if (d.type !== 'victory' && !d.playable) html += `<small>(nueva)</small>`;
        html += `</div>`;
    });
    return html + `</div>`;
}

function playersHtml() {
    let html = `<div class="col-card col-players">`;
    for (const id of state.order) {
        const p = state.players[id];
        if (!p) continue;
        const badges = [
            state.longestRoad === id ? '<span title="Camino más largo (+2)">🛣️</span>' : '',
            state.largestArmy === id ? '<span title="Ejército más grande (+2)">⚔️</span>' : '',
        ].join('');
        html += `<div class="col-player ${id === state.current ? 'current' : ''}">
            <span class="col-dot" style="background:${p.color}"></span>
            <span class="col-pname">${esc(p.name)}${id === state.me ? ' (Tú)' : ''} ${badges}</span>
            <span title="Puntos">⭐${p.points}</span>
            <span title="Cartas en la mano">🂠${p.cards}</span>
            <span title="Caballeros jugados">⚔️${p.knights}</span>
            <span title="Camino más largo">🛣️${p.roadLength}</span>
        </div>`;
    }
    return html + `</div>`;
}

function renderHand(me) {
    if (!me || !me.res) { handEl.innerHTML = ''; return; }
    handEl.innerHTML = RES.map(r => `
        <div class="col-rescard res-${r} ${me.res[r] ? '' : 'empty'}">
            <div class="col-resicon">${RES_INFO[r].icon}</div>
            <div class="col-resname">${RES_INFO[r].name}</div>
            <div class="col-rescount">${me.res[r]}</div>
        </div>`).join('') + `<div class="col-bankinfo">Banco: ${RES.map(r => `${RES_INFO[r].icon}${state.bank[r]}`).join(' ')} · 🃏${state.devLeft}</div>`;
}

const resList = res => RES.filter(r => res[r]).map(r => `${res[r]}${RES_INFO[r].icon}`).join(' ');

function startTimer() {
    clearInterval(timerInterval);
    const el = document.getElementById('col-timer');
    if (!el || state.status !== 'PLAYING') return;
    const deadline = Date.now() + state.turnSeconds * 1000;
    const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        el.textContent = `⏱ ${left}s`;
        el.classList.toggle('urgent', left <= 10);
    };
    tick();
    timerInterval = setInterval(tick, 1000);
}

// ---------- Clics del panel ----------
sideEl.addEventListener('change', e => {
    if (e.target.dataset.opt) act('setOption', { key: e.target.dataset.opt, value: e.target.checked });
});

sideEl.addEventListener('click', e => {
    if (e.target.closest('label')) return;
    const t = e.target.closest('button, a');
    if (!t || t.disabled) return;
    e.preventDefault();
    const d = t.dataset;
    if (d.mode) { mode = d.mode === 'none' || mode === d.mode ? null : d.mode; return render(); }
    if (d.disc) {
        discardDraft[d.disc] = Math.max(0, (discardDraft[d.disc] || 0) + Number(d.d));
        return render();
    }
    if (d.tr) {
        tradeDraft[d.tr][d.r] = (tradeDraft[d.tr][d.r] || 0) + 1;
        return render();
    }
    if (d.steal) return act('steal', { target: d.steal });
    if (d.accept) return act('acceptTrade', { id: Number(d.accept) });
    if (d.dev) {
        const i = d.i;
        const extra = {};
        if (d.dev === 'yearOfPlenty') { extra.res = document.getElementById(`col-yop1-${i}`).value; extra.res2 = document.getElementById(`col-yop2-${i}`).value; }
        if (d.dev === 'monopoly') extra.res = document.getElementById(`col-mono-${i}`).value;
        return act('playDev', { card: d.dev, ...extra });
    }
    switch (d.act) {
        case 'sit': return socket.emit('joinRoom', 'colonos');
        case 'start': case 'roll': case 'buyDev': case 'endTurn': case 'cancelTrade': return act(d.act);
        case 'discard': return act('discard', { res: { ...discardDraft } });
        case 'bankTrade': return act('bankTrade', { give: document.getElementById('col-bank-give').value, get: document.getElementById('col-bank-get').value });
        case 'clearTrade': tradeDraft = { give: {}, get: {} }; return render();
        case 'offerTrade': {
            act('offerTrade', { give: tradeDraft.give, get: tradeDraft.get });
            tradeDraft = { give: {}, get: {} };
            return;
        }
    }
});
