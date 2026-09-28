const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const colonos = require('./games/colonos')(io);
const casino = require('./games/casino')(io);   // Blackjack y Poker

app.use(express.static(path.join(__dirname, 'public')));
// Three.js para el tablero 3D del Monopoly (se sirve desde node_modules)
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Tablero clásico de 40 casillas (11x11). Precios, rentas y costos de casa del Monopoly original.
// rents = [terreno, 1 casa, 2, 3, 4, hotel]. Estaciones y servicios tienen reglas de renta propias.
const MONOPOLY_OWNABLE = ['property', 'railroad', 'utility'];
const P = (id, name, group, price, houseCost, rents) => ({ id, name, type: 'property', group, price, houseCost, rents });
const R = (id, name) => ({ id, name, type: 'railroad', group: 'railroad', price: 200 });
const U = (id, name) => ({ id, name, type: 'utility', group: 'utility', price: 150 });
const MONOPOLY_BOARD = [
  { id: 0, name: 'SALIDA', type: 'go' },
  P(1, 'Pasaje', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  { id: 2, name: 'Arca Comunal', type: 'chest' },
  P(3, 'Callejón', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  { id: 4, name: 'Impuesto a la Renta', type: 'tax', amount: 200 },
  R(5, 'Estación Norte'),
  P(6, 'Av. Norte', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  { id: 7, name: 'Suerte', type: 'chance' },
  P(8, 'Av. Sur', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  P(9, 'Plaza', 'lightblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  { id: 10, name: 'Cárcel', type: 'jail' },
  P(11, 'Centro', 'purple', 140, 100, [10, 50, 150, 450, 625, 750]),
  U(12, 'Compañía Eléctrica'),
  P(13, 'Galería', 'purple', 140, 100, [10, 50, 150, 450, 625, 750]),
  P(14, 'Mall', 'purple', 160, 100, [12, 60, 180, 500, 700, 900]),
  R(15, 'Estación Central'),
  P(16, 'Mercado', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  { id: 17, name: 'Arca Comunal', type: 'chest' },
  P(18, 'Teatro', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  P(19, 'Museo', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  { id: 20, name: 'Parking', type: 'parking' },
  P(21, 'Boulevard', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  { id: 22, name: 'Suerte', type: 'chance' },
  P(23, 'Costanera', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  P(24, 'Resort', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  R(25, 'Estación Sur'),
  P(26, 'Marina', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  P(27, 'Casino', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  U(28, 'Agua Potable'),
  P(29, 'Club de Golf', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { id: 30, name: 'Ir a Cárcel', type: 'goToJail' },
  P(31, 'Embajada', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  P(32, 'Bolsa', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { id: 33, name: 'Arca Comunal', type: 'chest' },
  P(34, 'Torre', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  R(35, 'Aeropuerto'),
  { id: 36, name: 'Suerte', type: 'chance' },
  P(37, 'Mansión', 'darkblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { id: 38, name: 'Impuesto de Lujo', type: 'tax', amount: 100 },
  P(39, 'Penthouse', 'darkblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
].map(c => MONOPOLY_OWNABLE.includes(c.type) ? { ...c, owner: null, houses: 0, mortgaged: false } : c);

// Montos del juego original
const MONOPOLY_JAIL_POSITION = 10;
const MONOPOLY_GO_SALARY = 200;
const MONOPOLY_JAIL_FINE = 50;
const MONOPOLY_HOTEL = 5;                 // houses === 5 significa hotel
const MONOPOLY_START_BALANCE = 1500;
const MONOPOLY_MORTGAGE_INTEREST = 0.1;   // levantar una hipoteca cuesta el valor + 10%
const MONOPOLY_TURN_SECONDS = 60;
const MONOPOLY_TOKENS = ['car', 'plane', 'dog', 'hat', 'ship', 'boot', 'cat', 'rocket'];

// Cartas de Suerte del juego original
const CHANCE_CARDS = [
  { text: 'Avanza hasta la Salida. Cobra $200.', type: 'advanceTo', position: 0 },
  { text: 'Avanza hasta Penthouse.', type: 'advanceTo', position: 39 },
  { text: 'Avanza hasta Resort. Si pasas por la Salida, cobra $200.', type: 'advanceTo', position: 24 },
  { text: 'Avanza hasta Centro. Si pasas por la Salida, cobra $200.', type: 'advanceTo', position: 11 },
  { text: 'Avanza hasta la estación más cercana. Si tiene dueño, paga el doble de la renta.', type: 'nearest', target: 'railroad' },
  { text: 'Avanza hasta la estación más cercana. Si tiene dueño, paga el doble de la renta.', type: 'nearest', target: 'railroad' },
  { text: 'Avanza hasta el servicio más cercano. Si tiene dueño, paga 10 veces los dados.', type: 'nearest', target: 'utility' },
  { text: 'El banco te paga un dividendo de $50.', type: 'gain', amount: 50 },
  { text: 'Sal libre de la cárcel. Guarda esta carta hasta que la uses.', type: 'jailFree' },
  { text: 'Retrocede 3 casillas.', type: 'moveBack', spaces: 3 },
  { text: 'Ve directo a la Cárcel. No pases por la Salida ni cobres $200.', type: 'goToJail' },
  { text: 'Reparaciones generales: paga $25 por cada casa y $100 por cada hotel.', type: 'repairs', perHouse: 25, perHotel: 100 },
  { text: 'Multa por exceso de velocidad: paga $15.', type: 'lose', amount: 15 },
  { text: 'Viaja a la Estación Norte. Si pasas por la Salida, cobra $200.', type: 'advanceTo', position: 5 },
  { text: 'Te eligieron presidente del directorio: paga $50 a cada jugador.', type: 'payEach', amount: 50 },
  { text: 'Vence tu préstamo de construcción: cobra $150.', type: 'gain', amount: 150 },
].map(c => ({ ...c, deck: 'chance' }));

// Cartas de Arca Comunal del juego original
const CHEST_CARDS = [
  { text: 'Avanza hasta la Salida. Cobra $200.', type: 'advanceTo', position: 0 },
  { text: 'Error del banco a tu favor: cobra $200.', type: 'gain', amount: 200 },
  { text: 'Honorarios médicos: paga $50.', type: 'lose', amount: 50 },
  { text: 'Vendes acciones: cobra $50.', type: 'gain', amount: 50 },
  { text: 'Sal libre de la cárcel. Guarda esta carta hasta que la uses.', type: 'jailFree' },
  { text: 'Ve directo a la Cárcel. No pases por la Salida ni cobres $200.', type: 'goToJail' },
  { text: 'Vence tu fondo de vacaciones: cobra $100.', type: 'gain', amount: 100 },
  { text: 'Devolución de impuestos: cobra $20.', type: 'gain', amount: 20 },
  { text: '¡Es tu cumpleaños! Cada jugador te paga $10.', type: 'collectFromAll', amount: 10 },
  { text: 'Vence tu seguro de vida: cobra $100.', type: 'gain', amount: 100 },
  { text: 'Gastos de hospital: paga $100.', type: 'lose', amount: 100 },
  { text: 'Matrícula del colegio: paga $50.', type: 'lose', amount: 50 },
  { text: 'Honorarios por asesoría: cobra $25.', type: 'gain', amount: 25 },
  { text: 'Reparaciones de calles: paga $40 por cada casa y $115 por cada hotel.', type: 'repairs', perHouse: 40, perHotel: 115 },
  { text: 'Segundo lugar en un concurso de belleza: cobra $10.', type: 'gain', amount: 10 },
  { text: 'Heredas $100.', type: 'gain', amount: 100 },
].map(c => ({ ...c, deck: 'chest' }));

const MONOPOLY_DECKS = { chance: CHANCE_CARDS, chest: CHEST_CARDS };

const MONOPOLY_COLORS = ['#FF4444', '#4488FF', '#44CC44', '#FFAA00', '#FF44FF', '#44FFFF'];

let rooms = {
    monopoly: {
        status: 'WAITING',
        players: {},
        board: JSON.parse(JSON.stringify(MONOPOLY_BOARD)),
        turnOrder: [],
        currentTurnIndex: 0,
        lastDice: [0, 0],
        message: '',
        currentCard: null,
        phase: 'ROLL',
        doublesCount: 0,
        extraRoll: false,
        turnSeconds: MONOPOLY_TURN_SECONDS,
        rollId: 0,
        moves: [],
        moveSeq: 0,
        events: [],
        eventSeq: 0
    }
};

// ================= MONOPOLY LOGIC =================
let monopolyTurnTimer = null;

function broadcastMonopolyState() {
    scheduleMonopolyTurnTimer();
    io.to('monopoly').emit('monopolyGameState', rooms.monopoly);
}

// Si el jugador de turno no actúa a tiempo, se juega su turno automáticamente.
function scheduleMonopolyTurnTimer() {
    clearTimeout(monopolyTurnTimer);
    monopolyTurnTimer = null;
    if (rooms.monopoly.status !== 'PLAYING') return;
    monopolyTurnTimer = setTimeout(autoPlayMonopolyTurn, MONOPOLY_TURN_SECONDS * 1000);
}

function autoPlayMonopolyTurn() {
    let m = rooms.monopoly;
    let playerId = currentMonopolyPlayerId();
    if (m.status !== 'PLAYING' || !playerId) return;
    const action = { ROLL: 'rollDice', BUYING: 'skipBuy', END_TURN: 'endTurn' }[m.phase];
    handleMonopolyAction(playerId, { action });
}

function currentMonopolyPlayerId() {
    let m = rooms.monopoly;
    return m.turnOrder[m.currentTurnIndex];
}

function rollDice() {
    return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

function startMonopolyGame(requesterId) {
    let m = rooms.monopoly;
    let pIds = Object.keys(m.players);
    if (!m.players[requesterId] || m.status === 'PLAYING' || pIds.length < 2) return;

    for (let id of pIds) {
        Object.assign(m.players[id], {
            balance: MONOPOLY_START_BALANCE, position: 0, inJail: false, jailTurns: 0,
            jailCards: 0, jailCardSources: [], eliminated: false, properties: []
        });
    }
    monopolyDecks = { chance: [], chest: [] };
    m.status = 'PLAYING';
    m.turnOrder = shuffleDeck(pIds);
    m.currentTurnIndex = 0;
    m.board = JSON.parse(JSON.stringify(MONOPOLY_BOARD));
    m.lastDice = [0, 0];
    m.moves = [];
    m.events = [];
    m.currentCard = null;
    m.phase = 'ROLL';
    m.doublesCount = 0;
    m.extraRoll = false;
    m.message = '¡El juego ha comenzado!';
    broadcastMonopolyState();
}

function isMonopolyGroupOwned(group, ownerId) {
    return rooms.monopoly.board.filter(c => c.group === group).every(c => c.owner === ownerId);
}

// opts: railroadMultiplier / utilityFactor para las cartas de "más cercano"
function getMonopolyRent(cell, opts = {}) {
    if (cell.mortgaged) return 0;
    let m = rooms.monopoly;
    if (cell.type === 'railroad') {
        let owned = m.board.filter(c => c.type === 'railroad' && c.owner === cell.owner).length;
        return 25 * 2 ** (owned - 1) * (opts.railroadMultiplier || 1);
    }
    if (cell.type === 'utility') {
        let owned = m.board.filter(c => c.type === 'utility' && c.owner === cell.owner).length;
        return (m.lastDice[0] + m.lastDice[1]) * (opts.utilityFactor || (owned === 2 ? 10 : 4));
    }
    if (cell.houses > 0) return cell.rents[cell.houses];
    // Terreno sin construir: renta doble si el dueño tiene todo el grupo
    return isMonopolyGroupOwned(cell.group, cell.owner) ? cell.rents[0] * 2 : cell.rents[0];
}

function monopolyGroup(group) {
    return rooms.monopoly.board.filter(c => c.group === group);
}

function monopolyUnmortgageCost(cell) {
    return Math.ceil(cell.price / 2 * (1 + MONOPOLY_MORTGAGE_INTEREST));
}

function mortgageMonopolyProperty(cell) {
    cell.mortgaged = true;
    rooms.monopoly.players[cell.owner].balance += cell.price / 2;
}

function sellMonopolyHouse(cell) {
    cell.houses--;
    rooms.monopoly.players[cell.owner].balance += cell.houseCost / 2;
}

// Cuando no le alcanza, el jugador junta dinero como en el juego original:
// primero hipoteca terrenos sin construcciones, después vende casas (a mitad de precio,
// de forma pareja) y al final hipoteca lo que quede.
function raiseMonopolyFunds(playerId, amount) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let owned = () => m.board.filter(c => c.owner === playerId);
    let mortgageable = () => owned()
        .filter(c => !c.mortgaged && monopolyGroup(c.group).every(g => g.houses === 0))
        .sort((a, b) => a.price - b.price);
    let sold = 0, mortgaged = 0;

    for (let c of mortgageable()) {
        if (player.balance >= amount) break;
        mortgageMonopolyProperty(c);
        mortgaged++;
    }
    while (player.balance < amount) {
        let built = owned().filter(c => c.houses > 0).sort((a, b) => b.houses - a.houses);
        if (!built.length) break;
        sellMonopolyHouse(built[0]);
        sold++;
    }
    for (let c of mortgageable()) {
        if (player.balance >= amount) break;
        mortgageMonopolyProperty(c);
        mortgaged++;
    }
    if (sold || mortgaged) {
        let parts = [];
        if (sold) parts.push(`vender ${sold} construcción(es)`);
        if (mortgaged) parts.push(`hipotecar ${mortgaged} propiedad(es)`);
        m.message += ` ${player.name} tuvo que ${parts.join(' e ')}.`;
    }
}

// Cobra `amount` al jugador. Si ni vendiendo e hipotecando le alcanza, queda en bancarrota.
function chargeMonopolyPlayer(playerId, amount, creditorId) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let creditor = creditorId && m.players[creditorId] && !m.players[creditorId].eliminated ? m.players[creditorId] : null;
    if (player.balance < amount) raiseMonopolyFunds(playerId, amount);
    if (player.balance >= amount) {
        player.balance -= amount;
        if (creditor) creditor.balance += amount;
        return true;
    }
    if (creditor) creditor.balance += player.balance;
    player.balance = 0;
    eliminateMonopolyPlayer(playerId, creditor ? creditorId : null);
    return false;
}

function releaseMonopolyProperties(playerId) {
    rooms.monopoly.board.forEach(c => {
        if (c.owner === playerId) {
            c.owner = null;
            c.houses = 0;
            c.mortgaged = false;
        }
    });
}

// Regla original: si la deuda es con otro jugador, este recibe todas las propiedades
// (hipotecadas) y las cartas; si es con el banco, las propiedades vuelven al banco.
function eliminateMonopolyPlayer(playerId, creditorId) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let creditor = creditorId ? m.players[creditorId] : null;
    if (creditor) {
        m.board.forEach(c => {
            if (c.owner === playerId) {
                c.owner = creditorId;
                creditor.properties.push(c.id);
            }
        });
        creditor.jailCardSources.push(...player.jailCardSources);
        creditor.jailCards = creditor.jailCardSources.length;
        m.message += ` ${player.name} quedó en bancarrota; sus propiedades pasan a ${creditor.name}.`;
    } else {
        releaseMonopolyProperties(playerId);
        m.message += ` ${player.name} quedó en bancarrota.`;
    }
    recordMonopolyEvent('bankrupt', { playerId, creditorId: creditor ? creditorId : null });
    player.eliminated = true;
    player.inJail = false;
    player.jailCards = 0;
    player.jailCardSources = [];
    player.properties = [];
    if (currentMonopolyPlayerId() === playerId) m.extraRoll = false;
    checkMonopolyWinner();
}

function checkMonopolyWinner() {
    let m = rooms.monopoly;
    if (m.status !== 'PLAYING') return;
    let active = m.turnOrder.filter(id => !m.players[id].eliminated);
    if (active.length <= 1) {
        m.status = 'FINISHED';
        if (active.length === 1) recordMonopolyEvent('win', { playerId: active[0] });
        m.message = active.length === 1
            ? `🏆 ¡${m.players[active[0]].name} ha ganado el juego!`
            : 'La partida terminó.';
    }
}

// walk = avanza casilla por casilla (dados); si no, es un salto directo (cartas, cárcel).
// Eventos para los efectos visuales del cliente (impuesto, renta, cárcel, compra, etc.)
function recordMonopolyEvent(type, data = {}) {
    rooms.monopoly.events.push({ type, ...data });
}

function recordMonopolyMove(playerId, from, to, walk) {
    if (from !== to) rooms.monopoly.moves.push({ playerId, from, to, walk });
}

function sendMonopolyPlayerToJail(playerId) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    recordMonopolyMove(playerId, player.position, MONOPOLY_JAIL_POSITION, false);
    player.position = MONOPOLY_JAIL_POSITION;
    player.inJail = true;
    player.jailTurns = 0;
    m.extraRoll = false;
}

function rollMonopolyDice(playerId) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let dice = rollDice();
    let isDouble = dice[0] === dice[1];
    let total = dice[0] + dice[1];

    m.lastDice = dice;
    m.rollId++;
    m.currentCard = null;
    m.phase = 'END_TURN';
    m.message = `${player.name} sacó ${dice[0]} y ${dice[1]}.`;

    if (player.inJail) {
        m.extraRoll = false;
        if (isDouble) {
            player.inJail = false;
            player.jailTurns = 0;
            m.message += ' ¡Dobles! Sale de la cárcel.';
            recordMonopolyEvent('freed', { playerId });
            moveMonopolyPlayer(playerId, total);
        } else if (player.jailTurns + 1 >= 3) {
            player.inJail = false;
            player.jailTurns = 0;
            m.message += ` Paga $${MONOPOLY_JAIL_FINE} tras 3 turnos y sale.`;
            if (chargeMonopolyPlayer(playerId, MONOPOLY_JAIL_FINE, null)) moveMonopolyPlayer(playerId, total);
        } else {
            player.jailTurns++;
            m.message += ` Sigue en la cárcel (${player.jailTurns}/3).`;
        }
    } else if (isDouble && m.doublesCount + 1 >= 3) {
        m.message += ' ¡Tres dobles seguidos! Va a la cárcel.';
        recordMonopolyEvent('jail', { playerId, reason: 'triple' });
        sendMonopolyPlayerToJail(playerId);
    } else {
        m.doublesCount = isDouble ? m.doublesCount + 1 : 0;
        m.extraRoll = isDouble;
        moveMonopolyPlayer(playerId, total);
    }
    settleMonopolyTurn(playerId);
}

function moveMonopolyPlayer(playerId, spaces) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let oldPos = player.position;
    player.position = (oldPos + spaces) % m.board.length;
    recordMonopolyMove(playerId, oldPos, player.position, true);
    if (player.position < oldPos) {
        player.balance += MONOPOLY_GO_SALARY;
        m.message += ` Pasó por la Salida (+$${MONOPOLY_GO_SALARY}).`;
        recordMonopolyEvent('go', { playerId, amount: MONOPOLY_GO_SALARY });
    }
    resolveMonopolyLanding(playerId, false);
}

function resolveMonopolyLanding(playerId, fromCard, rentOpts = {}) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    let cell = m.board[player.position];
    m.message += ` Cayó en ${cell.name}.`;

    if (MONOPOLY_OWNABLE.includes(cell.type)) {
        if (!cell.owner) {
            m.phase = 'BUYING';
        } else if (cell.owner !== playerId && cell.mortgaged) {
            m.message += ' Está hipotecada: no se paga renta.';
            recordMonopolyEvent('mortgagedLand', { playerId, cellId: cell.id });
        } else if (cell.owner !== playerId) {
            let rent = getMonopolyRent(cell, rentOpts);
            recordMonopolyEvent('rent', { playerId, ownerId: cell.owner, amount: rent, cellId: cell.id });
            m.message += ` Paga $${rent} de renta a ${m.players[cell.owner].name}.`;
            chargeMonopolyPlayer(playerId, rent, cell.owner);
        }
    } else if (cell.type === 'chance' && !fromCard) {
        recordMonopolyEvent('chance', { playerId, cellId: cell.id });
        applyChanceCard(playerId, drawMonopolyCard('chance'));
    } else if (cell.type === 'chest') {
        recordMonopolyEvent('chance', { playerId, cellId: cell.id });
        applyChanceCard(playerId, drawMonopolyCard('chest'));
    } else if (cell.type === 'tax') {
        m.message += ` Paga $${cell.amount} de impuestos.`;
        recordMonopolyEvent('tax', { playerId, amount: cell.amount, cellId: cell.id, name: cell.name });
        chargeMonopolyPlayer(playerId, cell.amount, null);
    } else if (cell.type === 'goToJail') {
        m.message += ' ¡Va a la cárcel!';
        recordMonopolyEvent('jail', { playerId });
        sendMonopolyPlayerToJail(playerId);
    } else if (cell.type === 'jail') {
        m.message += ' (Solo de visita)';
        recordMonopolyEvent('visit', { playerId });
    } else if (cell.type === 'parking') {
        recordMonopolyEvent('parking', { playerId });
    } else if (cell.type === 'go') {
        recordMonopolyEvent('landGo', { playerId });
    }
}

// Mazos barajados: se roba de arriba y se vuelven a barajar al acabarse.
// La carta "Sal libre de la cárcel" no vuelve a su mazo mientras alguien la tenga.
let monopolyDecks = { chance: [], chest: [] };
function drawMonopolyCard(deck) {
    let cards = MONOPOLY_DECKS[deck];
    if (!monopolyDecks[deck].length) {
        let held = Object.values(rooms.monopoly.players).some(p => (p.jailCardSources || []).includes(deck));
        monopolyDecks[deck] = shuffleDeck(cards.map((_, i) => i)
            .filter(i => !(held && cards[i].type === 'jailFree')));
    }
    return cards[monopolyDecks[deck].pop()];
}

function applyChanceCard(playerId, card) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    m.currentCard = card;
    m.message += ` Carta: ${card.text}`;

    if (card.type === 'gain') {
        player.balance += card.amount;
        recordMonopolyEvent('money', { playerId, amount: card.amount });
    } else if (card.type === 'lose') {
        recordMonopolyEvent('money', { playerId, amount: -card.amount });
        chargeMonopolyPlayer(playerId, card.amount, null);
    } else if (card.type === 'advanceTo') {
        let from = player.position;
        if (card.position < from || card.position === 0) {
            player.balance += MONOPOLY_GO_SALARY;
            m.message += ` Pasó por la Salida (+$${MONOPOLY_GO_SALARY}).`;
            recordMonopolyEvent('go', { playerId, amount: MONOPOLY_GO_SALARY });
        }
        recordMonopolyMove(playerId, from, card.position, true);
        player.position = card.position;
        resolveMonopolyLanding(playerId, true);
    } else if (card.type === 'nearest') {
        let from = player.position, pos = from;
        do { pos = (pos + 1) % m.board.length; } while (m.board[pos].type !== card.target);
        if (pos < from) {
            player.balance += MONOPOLY_GO_SALARY;
            m.message += ` Pasó por la Salida (+$${MONOPOLY_GO_SALARY}).`;
            recordMonopolyEvent('go', { playerId, amount: MONOPOLY_GO_SALARY });
        }
        recordMonopolyMove(playerId, from, pos, true);
        player.position = pos;
        resolveMonopolyLanding(playerId, true,
            card.target === 'railroad' ? { railroadMultiplier: 2 } : { utilityFactor: 10 });
    } else if (card.type === 'jailFree') {
        player.jailCardSources.push(card.deck);
        player.jailCards = player.jailCardSources.length;
        recordMonopolyEvent('jailFree', { playerId });
    } else if (card.type === 'goToJail') {
        recordMonopolyEvent('jail', { playerId });
        sendMonopolyPlayerToJail(playerId);
    } else if (card.type === 'collectFromAll') {
        for (let id of m.turnOrder) {
            if (id !== playerId && !m.players[id].eliminated) {
                chargeMonopolyPlayer(id, card.amount, playerId);
            }
        }
    } else if (card.type === 'payEach') {
        for (let id of m.turnOrder) {
            if (player.eliminated) break;
            if (id !== playerId && !m.players[id].eliminated) {
                chargeMonopolyPlayer(playerId, card.amount, id);
            }
        }
    } else if (card.type === 'repairs') {
        let total = m.board.filter(c => c.owner === playerId)
            .reduce((sum, c) => sum + (c.houses === MONOPOLY_HOTEL ? card.perHotel : c.houses * card.perHouse), 0);
        if (total > 0) {
            m.message += ` Total: $${total}.`;
            chargeMonopolyPlayer(playerId, total, null);
        }
    } else if (card.type === 'moveBack') {
        let backTo = (player.position - card.spaces + m.board.length) % m.board.length;
        recordMonopolyMove(playerId, player.position, backTo, false);
        player.position = backTo;
        resolveMonopolyLanding(playerId, true);
    }
}

// Decide la fase siguiente después de una acción del jugador de turno.
function settleMonopolyTurn(playerId) {
    let m = rooms.monopoly;
    if (m.status !== 'PLAYING') return;
    let player = m.players[playerId];
    if (player.eliminated) {
        advanceMonopolyTurn();
        return;
    }
    if (m.phase === 'BUYING') return;
    if (m.extraRoll && !player.inJail) {
        m.phase = 'ROLL';
        m.message += ' ¡Dobles, tira de nuevo!';
        recordMonopolyEvent('doubles', { playerId });
    } else {
        m.phase = 'END_TURN';
    }
}

function advanceMonopolyTurn() {
    let m = rooms.monopoly;
    m.currentCard = null;
    m.doublesCount = 0;
    m.extraRoll = false;
    m.phase = 'ROLL';
    if (m.status !== 'PLAYING' || m.turnOrder.length === 0) return;
    for (let i = 0; i < m.turnOrder.length; i++) {
        m.currentTurnIndex = (m.currentTurnIndex + 1) % m.turnOrder.length;
        if (!m.players[m.turnOrder[m.currentTurnIndex]].eliminated) break;
    }
}

function handleMonopolyAction(playerId, data) {
    let m = rooms.monopoly;
    if (m.status !== 'PLAYING' || currentMonopolyPlayerId() !== playerId || !data) return;
    let player = m.players[playerId];
    if (!player || player.eliminated) return;
    let cell = m.board[player.position];
    m.moves = [];
    m.events = [];

    if (data.action === 'rollDice') {
        if (m.phase !== 'ROLL') return;
        rollMonopolyDice(playerId);
    } else if (data.action === 'buyProperty') {
        if (m.phase !== 'BUYING') return;
        if (MONOPOLY_OWNABLE.includes(cell.type) && !cell.owner && player.balance >= cell.price) {
            player.balance -= cell.price;
            cell.owner = playerId;
            player.properties.push(cell.id);
            m.message = `${player.name} compró ${cell.name}.`;
            recordMonopolyEvent('buy', { playerId, cellId: cell.id });
        }
        m.phase = 'END_TURN';
        settleMonopolyTurn(playerId);
    } else if (data.action === 'skipBuy') {
        if (m.phase !== 'BUYING') return;
        m.message = `${player.name} no compró ${cell.name}.`;
        m.phase = 'END_TURN';
        settleMonopolyTurn(playerId);
    } else if (data.action === 'buyHouse') {
        if (!['ROLL', 'END_TURN'].includes(m.phase)) return;
        let prop = m.board.find(c => c.id === Number(data.propertyId));
        if (!prop || prop.type !== 'property' || prop.owner !== playerId || prop.houses >= MONOPOLY_HOTEL) return;
        let group = monopolyGroup(prop.group);
        // Regla original: grupo completo, nada hipotecado y construcción pareja
        if (!isMonopolyGroupOwned(prop.group, playerId) || group.some(c => c.mortgaged)) return;
        if (prop.houses > Math.min(...group.map(c => c.houses))) return;
        if (player.balance < prop.houseCost) return;
        player.balance -= prop.houseCost;
        prop.houses++;
        recordMonopolyEvent('build', { playerId, cellId: prop.id, hotel: prop.houses === MONOPOLY_HOTEL });
        m.message = prop.houses === MONOPOLY_HOTEL
            ? `${player.name} construyó un hotel en ${prop.name}.`
            : `${player.name} construyó una casa en ${prop.name}.`;
    } else if (data.action === 'sellHouse') {
        let prop = m.board.find(c => c.id === Number(data.propertyId));
        if (!prop || prop.owner !== playerId || prop.houses === 0) return;
        if (prop.houses < Math.max(...monopolyGroup(prop.group).map(c => c.houses))) return;
        sellMonopolyHouse(prop);
        m.message = `${player.name} vendió una construcción de ${prop.name} (+$${prop.houseCost / 2}).`;
    } else if (data.action === 'mortgage') {
        let prop = m.board.find(c => c.id === Number(data.propertyId));
        if (!prop || prop.owner !== playerId || prop.mortgaged) return;
        if (monopolyGroup(prop.group).some(c => c.houses > 0)) return;
        mortgageMonopolyProperty(prop);
        m.message = `${player.name} hipotecó ${prop.name} (+$${prop.price / 2}).`;
    } else if (data.action === 'unmortgage') {
        let prop = m.board.find(c => c.id === Number(data.propertyId));
        if (!prop || prop.owner !== playerId || !prop.mortgaged) return;
        let cost = monopolyUnmortgageCost(prop);
        if (player.balance < cost) return;
        player.balance -= cost;
        prop.mortgaged = false;
        m.message = `${player.name} levantó la hipoteca de ${prop.name} (-$${cost}).`;
    } else if (data.action === 'useJailCard') {
        if (m.phase !== 'ROLL' || !player.inJail || player.jailCards < 1) return;
        let source = player.jailCardSources.pop();
        player.jailCards = player.jailCardSources.length;
        player.inJail = false;
        player.jailTurns = 0;
        let cardIdx = MONOPOLY_DECKS[source].findIndex(c => c.type === 'jailFree');
        monopolyDecks[source].unshift(cardIdx);   // vuelve al fondo de su mazo
        m.message = `${player.name} usó la carta "Sal libre de la cárcel".`;
    } else if (data.action === 'payJail') {
        if (m.phase !== 'ROLL' || !player.inJail || player.balance < MONOPOLY_JAIL_FINE) return;
        player.balance -= MONOPOLY_JAIL_FINE;
        player.inJail = false;
        player.jailTurns = 0;
        m.message = `${player.name} pagó $${MONOPOLY_JAIL_FINE} y salió de la cárcel.`;
    } else if (data.action === 'endTurn') {
        if (m.phase !== 'END_TURN') return;
        advanceMonopolyTurn();
    } else {
        return;
    }
    if (m.moves.length) m.moveSeq++;
    if (m.events.length) m.eventSeq++;
    broadcastMonopolyState();
}

function setMonopolyToken(playerId, token) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    if (!player || m.status === 'PLAYING' || !MONOPOLY_TOKENS.includes(token)) return;
    if (Object.values(m.players).some(p => p.id !== playerId && p.token === token)) return;
    player.token = token;
    broadcastMonopolyState();
}

function joinMonopoly(socket) {
    let m = rooms.monopoly;
    socket.join('monopoly');
    if (!m.players[socket.id]) {
        let usedColors = Object.values(m.players).map(p => p.color);
        let color = MONOPOLY_COLORS.find(c => !usedColors.includes(c))
            || MONOPOLY_COLORS[Object.keys(m.players).length % MONOPOLY_COLORS.length];
        let usedTokens = Object.values(m.players).map(p => p.token);
        let token = MONOPOLY_TOKENS.find(t => !usedTokens.includes(t)) || MONOPOLY_TOKENS[0];
        m.players[socket.id] = {
            id: socket.id, name: socket.playerName || 'Jugador', balance: MONOPOLY_START_BALANCE,
            position: 0, inJail: false, jailTurns: 0, jailCards: 0, jailCardSources: [], color, token, eliminated: false, properties: []
        };
    }
    broadcastMonopolyState();
}

function removeMonopolyPlayer(playerId) {
    let m = rooms.monopoly;
    let player = m.players[playerId];
    if (!player) return;

    let wasCurrent = m.status === 'PLAYING' && currentMonopolyPlayerId() === playerId;
    releaseMonopolyProperties(playerId);
    delete m.players[playerId];

    let idx = m.turnOrder.indexOf(playerId);
    if (idx !== -1) {
        m.turnOrder.splice(idx, 1);
        if (idx < m.currentTurnIndex) m.currentTurnIndex--;
        if (m.status === 'PLAYING') {
            m.message = `${player.name} abandonó la partida.`;
            checkMonopolyWinner();
            if (m.status === 'PLAYING' && wasCurrent) {
                // El siguiente jugador ocupa ahora el índice del que se fue.
                m.currentTurnIndex = (idx - 1 + m.turnOrder.length) % m.turnOrder.length;
                advanceMonopolyTurn();
            }
        }
    }

    if (Object.keys(m.players).length === 0) {
        Object.assign(m, {
            status: 'WAITING', board: JSON.parse(JSON.stringify(MONOPOLY_BOARD)), turnOrder: [],
            currentTurnIndex: 0, lastDice: [0, 0], message: '', currentCard: null, phase: 'ROLL',
            doublesCount: 0, extraRoll: false, rollId: 0, moves: [], events: []
        });
    }
    broadcastMonopolyState();
}

// ================= SOCKET CONNECTIONS =================

io.on('connection', (socket) => {
    socket.on('setPlayerInfo', (info) => {
        socket.playerName = String((info && info.name) || '').trim().slice(0, 20) || 'Jugador';
    });

    socket.on('joinRoom', (roomName) => {
        if (roomName === 'blackjack' || roomName === 'poker') {
            casino.join(socket, roomName);
        }
        else if (roomName === 'monopoly') {
            joinMonopoly(socket);
        }
        else if (roomName === 'colonos') {
            colonos.join(socket);
        }
    });

    // MONOPOLY: Start and actions
    socket.on('startMonopoly', () => startMonopolyGame(socket.id));
    socket.on('setMonopolyToken', (token) => setMonopolyToken(socket.id, token));

    // COLONOS DE LA ISLA
    socket.on('colonosAction', (action) => colonos.handle(socket.id, action));
    socket.on('monopolyAction', (data) => handleMonopolyAction(socket.id, data));

    // BLACKJACK Y POKER
    socket.on('startPoker', () => casino.startPoker(socket.id));
    socket.on('pokerAction', (data) => casino.poker(socket.id, data));
    for (const type of ['placeBet', 'hit', 'stand', 'doubleDown', 'split']) {
        socket.on(type, (data) => casino.blackjack(socket.id, type, data));
    }

    socket.on('disconnect', () => {
        casino.leave(socket.id);
        removeMonopolyPlayer(socket.id);
        colonos.leave(socket.id);
    });

    // CHAT GLOBAL
    socket.on('chatMessage', (msg) => {
        const text = String(msg ?? '').trim().slice(0, 300);
        if (!text) return;
        io.emit('chatMessage', {
            name: socket.playerName || 'Anónimo',
            msg: text
        });
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {   // sin host: escucha en IPv4 e IPv6 (localhost funciona siempre)
    console.log(`Servidor de Juegos escuchando en el puerto ${PORT}`);
});
