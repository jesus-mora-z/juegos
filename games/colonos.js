// ================= COLONOS DE LA ISLA =================
// Juego de colonización con las reglas del juego base clásico (3-4 jugadores; se permite 2):
// recursos, caminos, pueblos, ciudades, ladrón, comercio con banco/puertos/jugadores,
// cartas de desarrollo, camino más largo y ejército más grande. Gana quien llega a 10 puntos.
// Expansión opcional "5-6 jugadores": isla de 30 hexágonos, 11 puertos, banco de 24,
// 34 cartas de desarrollo y fase de construcción especial entre turnos.

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const COSTS = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    dev: { sheep: 1, wheat: 1, ore: 1 },
};
const LIMITS = { road: 15, settlement: 5, city: 4 };
const COLORS = ['#d32f2f', '#1976d2', '#f57c00', '#f5f5f5', '#2e9d4a', '#7b4a2d'];
const MAX_PLAYERS = 6;
const WIN_POINTS = 10;
const TURN_SECONDS = 90;
const SPECIAL_BUILD_SECONDS = 30;

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
const emptyRes = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
const total = res => RES.reduce((s, r) => s + (res[r] || 0), 0);
const hasRes = (res, cost) => RES.every(r => (res[r] || 0) >= (cost[r] || 0));
const repeat = spec => Object.entries(spec).flatMap(([k, n]) => Array(n).fill(isNaN(k) ? k : Number(k)));

// ---------- Geometría de la isla: filas de hexágonos, vértices y aristas compartidos ----------
// Hexágonos "punta arriba" de radio 1; cada fila se centra en x = 0 y las filas se separan 1.5 en y.
function buildGeometry(rows) {
    const hexes = [], vertices = [], edges = [];
    const vIndex = new Map(), eIndex = new Map();
    const key = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const mid = (rows.length - 1) / 2;
    rows.forEach((len, row) => {
        for (let i = 0; i < len; i++) {
            const cx = Math.sqrt(3) * (i - (len - 1) / 2), cy = 1.5 * (row - mid);
            const hex = { id: hexes.length, x: cx, y: cy, vertices: [] };
            for (let k = 0; k < 6; k++) {
                const a = (Math.PI / 180) * (60 * k - 30);
                const x = cx + Math.cos(a), y = cy + Math.sin(a);
                const kk = key(x, y);
                if (!vIndex.has(kk)) {
                    vIndex.set(kk, vertices.length);
                    vertices.push({ id: vertices.length, x, y, hexes: [], edges: [], adj: [] });
                }
                const v = vertices[vIndex.get(kk)];
                v.hexes.push(hex.id);
                hex.vertices.push(v.id);
            }
            for (let k = 0; k < 6; k++) {
                const a = hex.vertices[k], b = hex.vertices[(k + 1) % 6];
                const kk = a < b ? `${a}-${b}` : `${b}-${a}`;
                if (!eIndex.has(kk)) {
                    eIndex.set(kk, edges.length);
                    edges.push({ id: edges.length, a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
                    vertices[a].edges.push(edges.length - 1);
                    vertices[b].edges.push(edges.length - 1);
                    vertices[a].adj.push(b);
                    vertices[b].adj.push(a);
                }
                edges[eIndex.get(kk)].hexes.push(hex.id);
            }
            hexes.push(hex);
        }
    });
    // Hexágonos vecinos (comparten dos vértices) y costa ordenada alrededor de la isla (para los puertos)
    const neighbors = hexes.map(h => hexes
        .filter(o => o.id !== h.id && o.vertices.filter(v => h.vertices.includes(v)).length === 2)
        .map(o => o.id));
    const coast = edges
        .filter(e => e.hexes.length === 1)
        .map(e => ({ e, ang: Math.atan2((vertices[e.a].y + vertices[e.b].y) / 2, (vertices[e.a].x + vertices[e.b].x) / 2) }))
        .sort((m, n) => m.ang - n.ang)
        .map(m => m.e);
    return { hexes, vertices, edges, neighbors, coast };
}

// Modos de juego: base (19 hexágonos) y expansión 5-6 jugadores (30 hexágonos)
const MODES = {
    base: {
        geo: buildGeometry([3, 4, 5, 4, 3]),
        maxPlayers: 4,
        bank: 19,
        tiles: repeat({ wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 }),
        numbers: repeat({ 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 }),
        ports: repeat({ any: 4, wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 }),
        dev: repeat({ knight: 14, victory: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 }),
        specialBuild: false,
    },
    big: {
        geo: buildGeometry([3, 4, 5, 6, 5, 4, 3]),
        maxPlayers: 6,
        bank: 24,
        tiles: repeat({ wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 }),
        numbers: repeat({ 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 }),
        ports: repeat({ any: 5, wood: 1, brick: 1, sheep: 2, wheat: 1, ore: 1 }),
        dev: repeat({ knight: 20, victory: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 }),
        specialBuild: true,
    },
};

function generateBoard(mode) {
    const { geo } = mode;
    for (let tries = 0; tries < 5000; tries++) {
        const tiles = shuffle([...mode.tiles]);
        const numbers = shuffle([...mode.numbers]);
        const hexes = geo.hexes.map((h, i) => ({
            id: h.id, x: h.x, y: h.y, vertices: h.vertices,
            resource: tiles[i], number: tiles[i] === 'desert' ? null : numbers.pop(),
        }));
        // Regla clásica: los 6 y 8 (números rojos) no pueden quedar juntos
        const hot = h => h.number === 6 || h.number === 8;
        if (hexes.some(h => hot(h) && geo.neighbors[h.id].some(n => hot(hexes[n])))) continue;
        const portTypes = shuffle([...mode.ports]);
        const step = geo.coast.length / portTypes.length;
        const ports = portTypes.map((type, i) => {
            const e = geo.coast[Math.round(i * step)];
            return { edge: e.id, type, vertices: [e.a, e.b] };
        });
        return { hexes, ports };
    }
    throw new Error('No se pudo generar la isla');
}

// ---------- Estado de la sala ----------
function newRoom(options = { big: false }) {
    const mode = options.big ? MODES.big : MODES.base;
    return {
        status: 'WAITING', players: {}, order: [], turn: 0, phase: null, options,
        board: null, buildings: {}, roads: {}, robber: null,
        bank: Object.fromEntries(RES.map(r => [r, mode.bank])),
        devDeck: [], dice: [0, 0], rollId: 0, turnNumber: 0,
        setupQueue: [], setupIndex: 0, lastSetupVertex: null,
        discard: {}, afterRobber: null, stealFrom: [], freeRoads: 0, devPlayed: false,
        sbQueue: [], sbReturn: 0,
        trade: null, largestArmy: null, longestRoad: null, winner: null, log: [],
    };
}

module.exports = function createColonos(io) {
    let room = newRoom();
    let timer = null;
    let MODE = MODES.base;
    let GEO = MODE.geo;

    const current = () => room.order[room.turn];
    const P = id => room.players[id];
    function log(text) {
        room.log.push(text);
        if (room.log.length > 30) room.log.shift();
    }
    const nameOf = id => P(id)?.name || 'Alguien';

    // ---------- Reglas de construcción ----------
    function vertexFree(v) {
        return !room.buildings[v] && GEO.vertices[v].adj.every(n => !room.buildings[n]);
    }
    function touchesOwnRoad(pid, v) {
        return GEO.vertices[v].edges.some(e => room.roads[e]?.owner === pid);
    }
    function canSettle(pid, v, setup) {
        return vertexFree(v) && (setup || touchesOwnRoad(pid, v));
    }
    function canRoad(pid, e) {
        if (room.roads[e]) return false;
        const edge = GEO.edges[e];
        if (room.phase === 'setupRoad') return edge.a === room.lastSetupVertex || edge.b === room.lastSetupVertex;
        return [edge.a, edge.b].some(v => {
            const b = room.buildings[v];
            if (b && b.owner === pid) return true;
            if (b && b.owner !== pid) return false;   // un pueblo rival corta el camino
            return GEO.vertices[v].edges.some(o => o !== e && room.roads[o]?.owner === pid);
        });
    }
    function count(pid, type) {
        if (type === 'road') return Object.values(room.roads).filter(r => r.owner === pid).length;
        return Object.values(room.buildings).filter(b => b.owner === pid && b.type === type).length;
    }
    function legalFor(pid) {
        const setup = room.phase === 'setupSettlement';
        const settlements = [], cities = [], roads = [];
        const building = room.phase === 'main' || room.phase === 'specialBuild';
        if (setup || building) {
            if (setup || count(pid, 'settlement') < LIMITS.settlement) {
                for (let v = 0; v < GEO.vertices.length; v++) if (canSettle(pid, v, setup)) settlements.push(v);
            }
        }
        if (building && count(pid, 'city') < LIMITS.city) {
            for (const v in room.buildings) {
                const b = room.buildings[v];
                if (b.owner === pid && b.type === 'settlement') cities.push(Number(v));
            }
        }
        if (['setupRoad', 'main', 'roadBuilding', 'specialBuild'].includes(room.phase) && count(pid, 'road') < LIMITS.road) {
            for (let e = 0; e < GEO.edges.length; e++) if (canRoad(pid, e)) roads.push(e);
        }
        return { settlements, cities, roads };
    }

    // ---------- Puertos y comercio con el banco ----------
    function rateFor(pid, res) {
        let rate = 4;
        for (const port of room.board.ports) {
            if (!port.vertices.some(v => room.buildings[v]?.owner === pid)) continue;
            if (port.type === res) rate = Math.min(rate, 2);
            else if (port.type === 'any') rate = Math.min(rate, 3);
        }
        return rate;
    }

    // ---------- Camino más largo y ejército más grande ----------
    function longestRoadOf(pid) {
        const mine = Object.keys(room.roads).map(Number).filter(e => room.roads[e].owner === pid);
        let best = 0;
        const blocked = v => room.buildings[v] && room.buildings[v].owner !== pid;
        function walk(v, used) {
            let longest = used.size;
            if (blocked(v) && used.size > 0) return longest;
            for (const e of GEO.vertices[v].edges) {
                if (used.has(e) || room.roads[e]?.owner !== pid) continue;
                const edge = GEO.edges[e];
                used.add(e);
                longest = Math.max(longest, walk(edge.a === v ? edge.b : edge.a, used));
                used.delete(e);
            }
            return longest;
        }
        for (const e of mine) {
            const edge = GEO.edges[e];
            best = Math.max(best, walk(edge.a, new Set()), walk(edge.b, new Set()));
        }
        return best;
    }
    function updateAwards() {
        // Camino más largo: mínimo 5; el poseedor lo conserva en caso de empate
        const lengths = {};
        for (const pid of room.order) lengths[pid] = longestRoadOf(pid);
        const holder = room.longestRoad;
        let leader = holder && lengths[holder] >= 5 ? holder : null;
        for (const pid of room.order) {
            if (lengths[pid] >= 5 && lengths[pid] > (leader ? lengths[leader] : 4)) leader = pid;
        }
        if (holder && leader === holder && lengths[holder] < 5) leader = null;
        if (leader !== holder) {
            if (leader) log(`🛣️ ${nameOf(leader)} tiene el camino más largo (${lengths[leader]}).`);
            room.longestRoad = leader;
        }
        for (const pid of room.order) P(pid).roadLength = lengths[pid];
        // Ejército más grande: mínimo 3 caballeros
        let army = room.largestArmy;
        for (const pid of room.order) {
            const k = P(pid).knights;
            if (k >= 3 && k > (army ? P(army)?.knights || 0 : 2)) army = pid;
        }
        if (army !== room.largestArmy) {
            log(`⚔️ ${nameOf(army)} tiene el ejército más grande.`);
            room.largestArmy = army;
        }
    }
    function points(pid, includeHidden) {
        const p = P(pid);
        let pts = 0;
        for (const b of Object.values(room.buildings)) if (b.owner === pid) pts += b.type === 'city' ? 2 : 1;
        if (room.longestRoad === pid) pts += 2;
        if (room.largestArmy === pid) pts += 2;
        if (includeHidden) pts += p.dev.filter(d => d.type === 'victory').length;
        return pts;
    }
    function checkWin() {
        const pid = current();
        if (room.status === 'PLAYING' && pid && room.phase !== 'specialBuild' && points(pid, true) >= WIN_POINTS) {
            room.status = 'FINISHED';
            room.winner = pid;
            room.phase = null;
            log(`🏆 ¡${nameOf(pid)} gana con ${points(pid, true)} puntos!`);
        }
    }

    // ---------- Recursos ----------
    function pay(pid, cost) {
        for (const r of RES) {
            P(pid).res[r] -= cost[r] || 0;
            room.bank[r] += cost[r] || 0;
        }
    }
    function produce(n) {
        const demand = {};   // recurso -> { pid: cantidad }
        for (const hex of room.board.hexes) {
            if (hex.number !== n || hex.id === room.robber) continue;
            for (const v of hex.vertices) {
                const b = room.buildings[v];
                if (!b || !P(b.owner)) continue;
                demand[hex.resource] = demand[hex.resource] || {};
                demand[hex.resource][b.owner] = (demand[hex.resource][b.owner] || 0) + (b.type === 'city' ? 2 : 1);
            }
        }
        const gains = [];
        for (const r in demand) {
            const wanted = Object.values(demand[r]).reduce((s, x) => s + x, 0);
            const takers = Object.keys(demand[r]);
            // Regla clásica: si el banco no alcanza y reciben varios, nadie recibe ese recurso
            if (wanted > room.bank[r] && takers.length > 1) continue;
            for (const pid of takers) {
                const amount = Math.min(demand[r][pid], room.bank[r]);
                P(pid).res[r] += amount;
                room.bank[r] -= amount;
                if (amount) gains.push(`${nameOf(pid)} +${amount} ${r}`);
            }
        }
        return gains;
    }

    // ---------- Turnos ----------
    function startGame(requester) {
        if (room.status === 'PLAYING' || !P(requester) || room.order.length < 2) return;
        const mode = room.options.big ? MODES.big : MODES.base;
        if (room.order.length > mode.maxPlayers) return;
        const keep = room.order.map(id => P(id));
        MODE = mode;
        GEO = mode.geo;
        const fresh = newRoom(room.options);
        room = Object.assign(fresh, { players: room.players, order: shuffle(room.order.slice()) });
        keep.forEach(p => Object.assign(p, {
            res: emptyRes(), dev: [], knights: 0, roadLength: 0,
        }));
        const board = generateBoard(MODE);
        room.board = board;
        room.robber = board.hexes.find(h => h.resource === 'desert').id;
        room.devDeck = shuffle([...MODE.dev]);
        room.status = 'PLAYING';
        room.setupQueue = [...room.order, ...room.order.slice().reverse()];
        room.setupIndex = 0;
        room.turn = room.order.indexOf(room.setupQueue[0]);
        room.phase = 'setupSettlement';
        log(room.options.big ? '🏝️ ¡Comienza la colonización con la expansión 5-6 jugadores!' : '🏝️ ¡Comienza la colonización! Cada jugador coloca un pueblo y un camino.');
    }

    function advanceSetup() {
        room.setupIndex++;
        if (room.setupIndex >= room.setupQueue.length) {
            room.turn = 0;
            room.phase = 'roll';
            room.turnNumber++;
            log(`🎲 Turno de ${nameOf(current())}.`);
            return;
        }
        room.turn = room.order.indexOf(room.setupQueue[room.setupIndex]);
        room.phase = 'setupSettlement';
    }

    function nextTurn() {
        room.trade = null;
        room.devPlayed = false;
        room.freeRoads = 0;
        room.turn = (room.turn + 1) % room.order.length;
        room.turnNumber++;
        room.phase = 'roll';
        log(`🎲 Turno de ${nameOf(current())}.`);
    }

    function startSpecialBuild() {
        room.trade = null;
        room.sbReturn = room.turn;
        const n = room.order.length;
        room.sbQueue = Array.from({ length: n - 1 }, (_, k) => room.order[(room.turn + k + 1) % n]);
        room.phase = 'specialBuild';
        room.turn = room.order.indexOf(room.sbQueue.shift());
        log('🔨 Fase de construcción especial: los demás pueden construir.');
    }

    function advanceSpecialBuild() {
        if (room.sbQueue.length) {
            room.turn = room.order.indexOf(room.sbQueue.shift());
        } else {
            room.turn = room.sbReturn;
            nextTurn();
        }
    }

    function startRobber(after) {
        room.afterRobber = after;
        room.phase = 'robber';
    }

    function afterRobberMoved() {
        const pid = current();
        const victims = [...new Set(room.board.hexes[room.robber].vertices
            .map(v => room.buildings[v]?.owner)
            .filter(o => o && o !== pid && P(o) && total(P(o).res) > 0))];
        if (victims.length === 0) { room.phase = room.afterRobber; return; }
        if (victims.length === 1) { steal(victims[0]); return; }
        room.stealFrom = victims;
        room.phase = 'steal';
    }

    function steal(victim) {
        const pid = current();
        const cards = RES.flatMap(r => Array(P(victim).res[r]).fill(r));
        if (cards.length) {
            const r = cards[Math.floor(Math.random() * cards.length)];
            P(victim).res[r]--;
            P(pid).res[r]++;
            log(`🦹 ${nameOf(pid)} le robó una carta a ${nameOf(victim)}.`);
        }
        room.stealFrom = [];
        room.phase = room.afterRobber;
    }

    function roll() {
        const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
        room.dice = d;
        room.rollId++;
        const n = d[0] + d[1];
        log(`🎲 ${nameOf(current())} sacó ${n}.`);
        if (n === 7) {
            room.discard = {};
            for (const pid of room.order) {
                const t = total(P(pid).res);
                if (t > 7) room.discard[pid] = Math.floor(t / 2);
            }
            if (Object.keys(room.discard).length) {
                room.phase = 'discard';
                log('⚠️ ¡7! Quienes tienen más de 7 cartas descartan la mitad.');
            } else {
                startRobber('main');
            }
        } else {
            const gains = produce(n);
            if (!gains.length) log('Nadie produce esta vez.');
            room.phase = 'main';
        }
    }

    // ---------- Acciones ----------
    function handle(pid, a) {
        if (!a || !P(pid)) return;
        if (a.type === 'start') { startGame(pid); broadcast(); return; }
        if (a.type === 'setOption') {
            if (room.status !== 'PLAYING' && a.key === 'big') {
                room.options = { ...room.options, big: !!a.value };
                log(room.options.big ? '➕ Expansión 5-6 jugadores activada.' : '➖ Se juega sin expansión.');
                broadcast();
            }
            return;
        }
        if (room.status !== 'PLAYING') return;
        const me = P(pid);
        const isTurn = current() === pid;

        switch (a.type) {
            case 'placeSettlement': {
                const v = Number(a.v);
                if (!isTurn || !GEO.vertices[v]) return;
                if (room.phase === 'setupSettlement') {
                    if (!canSettle(pid, v, true)) return;
                    room.buildings[v] = { owner: pid, type: 'settlement', color: me.color };
                    room.lastSetupVertex = v;
                    // Segundo pueblo: recibe los recursos de sus hexágonos
                    if (room.setupIndex >= room.order.length) {
                        for (const h of GEO.vertices[v].hexes) {
                            const r = room.board.hexes[h].resource;
                            if (r !== 'desert' && room.bank[r] > 0) { me.res[r]++; room.bank[r]--; }
                        }
                    }
                    room.phase = 'setupRoad';
                } else if (room.phase === 'main' || room.phase === 'specialBuild') {
                    if (!canSettle(pid, v, false) || !hasRes(me.res, COSTS.settlement) || count(pid, 'settlement') >= LIMITS.settlement) return;
                    pay(pid, COSTS.settlement);
                    room.buildings[v] = { owner: pid, type: 'settlement', color: me.color };
                    log(`🏠 ${me.name} construyó un pueblo.`);
                    updateAwards();   // un pueblo puede cortar un camino rival
                } else return;
                break;
            }
            case 'placeRoad': {
                const e = Number(a.e);
                if (!isTurn || !GEO.edges[e] || !canRoad(pid, e) || count(pid, 'road') >= LIMITS.road) return;
                if (room.phase === 'setupRoad') {
                    room.roads[e] = { owner: pid, color: me.color };
                    advanceSetup();
                } else if (room.phase === 'roadBuilding') {
                    room.roads[e] = { owner: pid, color: me.color };
                    room.freeRoads--;
                    if (room.freeRoads <= 0 || legalFor(pid).roads.length === 0) room.phase = 'main';
                } else if (room.phase === 'main' || room.phase === 'specialBuild') {
                    if (!hasRes(me.res, COSTS.road)) return;
                    pay(pid, COSTS.road);
                    room.roads[e] = { owner: pid, color: me.color };
                } else return;
                updateAwards();
                break;
            }
            case 'placeCity': {
                const v = Number(a.v);
                const b = room.buildings[v];
                if (!isTurn || !['main', 'specialBuild'].includes(room.phase) || !b || b.owner !== pid || b.type !== 'settlement') return;
                if (!hasRes(me.res, COSTS.city) || count(pid, 'city') >= LIMITS.city) return;
                pay(pid, COSTS.city);
                b.type = 'city';
                log(`🏙️ ${me.name} convirtió un pueblo en ciudad.`);
                break;
            }
            case 'roll':
                if (!isTurn || room.phase !== 'roll') return;
                roll();
                break;
            case 'discard': {
                const need = room.discard[pid];
                if (room.phase !== 'discard' || !need || !a.res) return;
                const give = {};
                for (const r of RES) give[r] = Math.max(0, Math.floor(Number(a.res[r]) || 0));
                if (total(give) !== need || !hasRes(me.res, give)) return;
                pay(pid, give);
                delete room.discard[pid];
                log(`${me.name} descartó ${need} cartas.`);
                if (!Object.keys(room.discard).length) startRobber('main');
                break;
            }
            case 'moveRobber': {
                const h = Number(a.hex);
                if (!isTurn || room.phase !== 'robber' || !room.board.hexes[h] || h === room.robber) return;
                room.robber = h;
                log(`🦹 ${me.name} movió al ladrón.`);
                afterRobberMoved();
                break;
            }
            case 'steal':
                if (!isTurn || room.phase !== 'steal' || !room.stealFrom.includes(a.target)) return;
                steal(a.target);
                break;
            case 'buyDev':
                if (!isTurn || !['main', 'specialBuild'].includes(room.phase) || !room.devDeck.length || !hasRes(me.res, COSTS.dev)) return;
                pay(pid, COSTS.dev);
                me.dev.push({ type: room.devDeck.pop(), turn: room.turnNumber });
                log(`🃏 ${me.name} compró una carta de desarrollo.`);
                break;
            case 'playDev': {
                if (!isTurn || room.devPlayed || !['roll', 'main'].includes(room.phase)) return;
                const idx = me.dev.findIndex(d => d.type === a.card && d.type !== 'victory' && d.turn < room.turnNumber);
                if (idx < 0) return;
                if (a.card !== 'knight' && room.phase !== 'main') return;   // solo el caballero antes de tirar
                if (a.card === 'yearOfPlenty') {
                    const picks = [a.res, a.res2];
                    if (!picks.every(r => RES.includes(r))) return;
                    const want = emptyRes();
                    picks.forEach(r => want[r]++);
                    if (!RES.every(r => room.bank[r] >= want[r])) return;
                    picks.forEach(r => { me.res[r]++; room.bank[r]--; });
                    log(`🌾 ${me.name} jugó Año de abundancia.`);
                } else if (a.card === 'monopoly') {
                    if (!RES.includes(a.res)) return;
                    let got = 0;
                    for (const o of room.order) {
                        if (o === pid) continue;
                        got += P(o).res[a.res];
                        P(o).res[a.res] = 0;
                    }
                    me.res[a.res] += got;
                    log(`💰 ${me.name} jugó Monopolio y se llevó ${got} de ${a.res}.`);
                } else if (a.card === 'roadBuilding') {
                    if (legalFor(pid).roads.length === 0 && room.phase === 'main') return;
                    room.freeRoads = Math.min(2, LIMITS.road - count(pid, 'road'));
                    room.phase = 'roadBuilding';
                    log(`🛣️ ${me.name} jugó Construcción de caminos.`);
                } else if (a.card === 'knight') {
                    me.knights++;
                    log(`⚔️ ${me.name} jugó un Caballero.`);
                    updateAwards();
                    startRobber(room.phase);
                }
                me.dev.splice(idx, 1);
                room.devPlayed = true;
                break;
            }
            case 'bankTrade': {
                if (!isTurn || room.phase !== 'main' || !RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) return;
                const rate = rateFor(pid, a.give);
                if (me.res[a.give] < rate || room.bank[a.get] < 1) return;
                me.res[a.give] -= rate; room.bank[a.give] += rate;
                me.res[a.get]++; room.bank[a.get]--;
                log(`🏦 ${me.name} cambió ${rate} ${a.give} por 1 ${a.get}.`);
                break;
            }
            case 'offerTrade': {
                if (!isTurn || room.phase !== 'main' || !a.give || !a.get) return;
                const give = emptyRes(), get = emptyRes();
                for (const r of RES) {
                    give[r] = Math.max(0, Math.floor(Number(a.give[r]) || 0));
                    get[r] = Math.max(0, Math.floor(Number(a.get[r]) || 0));
                }
                if (!total(give) || !total(get) || !hasRes(me.res, give)) return;
                room.trade = { from: pid, give, get, id: (room.trade?.id || 0) + 1 };
                log(`🤝 ${me.name} ofrece un intercambio.`);
                break;
            }
            case 'acceptTrade': {
                const t = room.trade;
                if (!t || t.from === pid || t.id !== a.id) return;
                const from = P(t.from);
                if (!from || !hasRes(from.res, t.give) || !hasRes(me.res, t.get)) return;
                for (const r of RES) {
                    from.res[r] += t.get[r] - t.give[r];
                    me.res[r] += t.give[r] - t.get[r];
                }
                room.trade = null;
                log(`🤝 ${from.name} y ${me.name} hicieron un intercambio.`);
                break;
            }
            case 'cancelTrade':
                if (!room.trade || room.trade.from !== pid) return;
                room.trade = null;
                break;
            case 'endTurn':
                if (!isTurn) return;
                if (room.phase === 'specialBuild') { advanceSpecialBuild(); break; }
                if (!['main', 'roadBuilding'].includes(room.phase)) return;
                if (MODE.specialBuild && room.order.length > 1) startSpecialBuild();
                else nextTurn();
                break;
            default:
                return;
        }
        checkWin();
        broadcast();
    }

    // Si alguien no actúa a tiempo, se juega su parte automáticamente para no trabar la mesa
    function autoPlay() {
        if (room.status !== 'PLAYING') return;
        const pid = current();
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        const legal = legalFor(pid);
        switch (room.phase) {
            case 'setupSettlement': return handle(pid, { type: 'placeSettlement', v: pick(legal.settlements) });
            case 'setupRoad': return handle(pid, { type: 'placeRoad', e: pick(legal.roads) });
            case 'roll': return handle(pid, { type: 'roll' });
            case 'discard':
                for (const o of Object.keys(room.discard)) {
                    const cards = shuffle(RES.flatMap(r => Array(P(o).res[r]).fill(r))).slice(0, room.discard[o]);
                    const res = emptyRes();
                    cards.forEach(r => res[r]++);
                    handle(o, { type: 'discard', res });
                }
                return;
            case 'robber': return handle(pid, { type: 'moveRobber', hex: pick(room.board.hexes.filter(h => h.id !== room.robber)).id });
            case 'steal': return handle(pid, { type: 'steal', target: pick(room.stealFrom) });
            default: return handle(pid, { type: 'endTurn' });
        }
    }

    // ---------- Envío del estado (cada jugador ve solo sus cartas) ----------
    function stateFor(viewer) {
        const players = {};
        for (const pid of Object.keys(room.players)) {
            const p = room.players[pid];
            const mine = pid === viewer;
            players[pid] = {
                id: pid, name: p.name, color: p.color,
                cards: total(p.res), devCount: p.dev.length, knights: p.knights, roadLength: p.roadLength || 0,
                points: points(pid, mine || room.status === 'FINISHED'),
                res: mine ? p.res : null,
                dev: mine ? p.dev.map(d => ({ type: d.type, playable: d.turn < room.turnNumber })) : null,
                rates: mine && room.board ? Object.fromEntries(RES.map(r => [r, rateFor(pid, r)])) : null,
                pieces: room.board ? {
                    road: LIMITS.road - count(pid, 'road'),
                    settlement: LIMITS.settlement - count(pid, 'settlement'),
                    city: LIMITS.city - count(pid, 'city'),
                } : null,
            };
        }
        const isTurn = current() === viewer;
        return {
            status: room.status, phase: room.phase, order: room.order, current: current(), me: viewer,
            geometry: room.board ? { vertices: GEO.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })), edges: GEO.edges.map(e => ({ id: e.id, a: e.a, b: e.b })) } : null,
            board: room.board, buildings: room.buildings, roads: room.roads, robber: room.robber,
            bank: room.bank, devLeft: room.devDeck.length, dice: room.dice, rollId: room.rollId,
            discardNeeded: room.discard[viewer] || 0, discardPending: Object.keys(room.discard),
            stealFrom: isTurn ? room.stealFrom : [], freeRoads: room.freeRoads, devPlayed: room.devPlayed,
            trade: room.trade, longestRoad: room.longestRoad, largestArmy: room.largestArmy,
            winner: room.winner, log: room.log, players, turnSeconds: phaseSeconds(),
            options: room.options, maxPlayers: (room.options.big ? MODES.big : MODES.base).maxPlayers,
            legal: isTurn && room.status === 'PLAYING' ? legalFor(viewer) : null,
            costs: COSTS,
        };
    }

    const phaseSeconds = () => (room.phase === 'specialBuild' ? SPECIAL_BUILD_SECONDS : TURN_SECONDS);

    function broadcast() {
        clearTimeout(timer);
        if (room.status === 'PLAYING') timer = setTimeout(autoPlay, phaseSeconds() * 1000);
        const sockets = io.sockets.adapter.rooms.get('colonos');
        if (!sockets) return;
        for (const sid of sockets) io.to(sid).emit('colonosState', stateFor(sid));
    }

    return {
        join(socket) {
            socket.join('colonos');
            if (!room.players[socket.id]) {
                if (room.order.length >= MAX_PLAYERS || room.status === 'PLAYING') {
                    // Mesa llena o partida en curso: mira como espectador
                    socket.emit('colonosState', stateFor(socket.id));
                    return;
                }
                const used = room.order.map(id => room.players[id].color);
                room.players[socket.id] = {
                    id: socket.id, name: socket.playerName || 'Jugador',
                    color: COLORS.find(c => !used.includes(c)), res: emptyRes(), dev: [], knights: 0, roadLength: 0,
                };
                room.order.push(socket.id);
            }
            broadcast();
        },
        leave(id) {
            if (!room.players[id]) return;
            const name = room.players[id].name;
            const wasTurn = current() === id;
            const actorId = current();
            const removedBefore = room.setupQueue.slice(0, room.setupIndex).filter(s => s === id).length;
            const idx = room.order.indexOf(id);
            for (const r of RES) room.bank[r] += room.players[id].res[r];   // sus cartas vuelven al banco
            delete room.players[id];
            room.order.splice(idx, 1);
            if (room.trade?.from === id) room.trade = null;
            delete room.discard[id];
            room.stealFrom = room.stealFrom.filter(s => s !== id);
            if (!room.order.length) { clearTimeout(timer); room = newRoom(); broadcast(); return; }   // los espectadores ven la mesa libre
            if (room.status === 'PLAYING') {
                log(`${name} abandonó la partida.`);
                room.setupQueue = room.setupQueue.filter(s => s !== id);
                room.setupIndex -= removedBefore;
                if (room.order.length < 2) {
                    room.status = 'FINISHED';
                    room.winner = room.order[0];
                    log(`🏆 ${nameOf(room.winner)} gana: se fueron los demás.`);
                } else if (room.phase && room.phase.startsWith('setup')) {
                    if (wasTurn) { room.setupIndex--; advanceSetup(); }
                    else room.turn = room.order.indexOf(room.setupQueue[room.setupIndex]);
                } else if (room.phase === 'specialBuild') {
                    let ret = room.sbReturn;
                    if (idx < ret) ret--;
                    else if (idx === ret) ret = (ret - 1 + room.order.length) % room.order.length;
                    room.sbReturn = ret;
                    room.sbQueue = room.sbQueue.filter(q => q !== id);
                    if (wasTurn) advanceSpecialBuild();
                    else room.turn = room.order.indexOf(actorId);
                    updateAwards();
                } else {
                    if (idx < room.turn) room.turn--;
                    if (wasTurn) { room.turn = (room.turn - 1 + room.order.length) % room.order.length; nextTurn(); }
                    else if (room.phase === 'discard' && !Object.keys(room.discard).length) startRobber('main');
                    updateAwards();
                }
            }
            broadcast();
        },
        handle,
    };

};
