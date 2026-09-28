// ================= BLACKJACK Y POKER (Texas Hold'em) =================
// Mismos eventos de socket que usa el cliente: 'gameState' / 'pokerGameState' hacia el navegador y
// 'placeBet', 'hit', 'stand', 'doubleDown', 'startPoker', 'pokerAction' desde el navegador.
// Protecciones: montos validados (sin apuestas negativas), desconexiones a mitad de mano sin
// romper el servidor, tiempos límite para que nadie trabe la mesa y botes laterales en el Poker.
const { Hand } = require('pokersolver');

const START_BALANCE = 10000;
const BJ_MIN_BET = 10;
const BJ_BET_SECONDS = 20;     // una vez que alguien apuesta, los demás tienen este tiempo para sumarse
const BJ_TURN_SECONDS = 30;    // si no juega su mano, se planta solo
const POKER_TURN_SECONDS = 30; // si no actúa, pasa (check) o se retira (fold)
const POKER_MIN_BET = 20;
const BJ_DEAL_CARD_MS = 350;   // ritmo del reparto inicial (debe coincidir con el cliente)
const BJ_DEALER_DRAW_MS = 1000; // pausa entre cada carta que pide el crupier

const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function newDeck(decks = 1) {
    const deck = [];
    for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const value of VALUES) deck.push({ suit, value });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function scoreOf(cards) {
    let score = 0, aces = 0;
    for (const c of cards) {
        if (['J', 'Q', 'K'].includes(c.value)) score += 10;
        else if (c.value === 'A') { score += 11; aces++; }
        else score += parseInt(c.value, 10);
    }
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}
const isNatural = cards => cards.length === 2 && scoreOf(cards) === 21;
const suitColor = suit => (suit === 'Hearts' || suit === 'Diamonds' ? 'red' : 'black');
const solverCard = c => (c.value === '10' ? 'T' : c.value) + c.suit[0].toLowerCase();

// Entero >= 0 o null si el valor no es un número válido
function amountOf(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

module.exports = function createCasino(io) {
    // ======================= BLACKJACK =======================
    // Cada jugador tiene una o más manos (al dividir): hands = [{ cards, bet, score, state, result }].
    // p.mainBet es el total apostado en la ronda y p.handIndex la mano que está jugando.
    const bj = {
        status: 'WAITING', players: {}, dealerCards: [], deck: [],
        currentPlayerIndex: 0, roundPlayers: [], betDeadline: null,
    };
    const MAX_HANDS = 4;
    let bjBetTimer = null, bjTurnTimer = null, bjDealerTimer = null, bjResetTimer = null;
    const pointValue = c => (['10', 'J', 'Q', 'K'].includes(c.value) ? 10 : c.value);

    function bjBroadcast() {
        const state = JSON.parse(JSON.stringify({ ...bj, deck: undefined }));
        if (['DEALING', 'PLAYING'].includes(state.status) && state.dealerCards.length > 1) {
            state.dealerCards[1] = { hidden: true };
        }
        state.betSecondsLeft = bj.betDeadline ? Math.max(0, Math.ceil((bj.betDeadline - Date.now()) / 1000)) : null;
        state.turnSeconds = BJ_TURN_SECONDS;
        io.to('blackjack').emit('gameState', state);
    }

    const bjCurrentId = () => bj.roundPlayers[bj.currentPlayerIndex];
    function bjCurrentHand() {
        const p = bj.players[bjCurrentId()];
        return p ? p.hands[p.handIndex] : null;
    }

    function bjScheduleTurn() {
        clearTimeout(bjTurnTimer);
        if (bj.status !== 'PLAYING') return;
        const id = bjCurrentId(), handIndex = bj.players[id]?.handIndex;
        bjTurnTimer = setTimeout(() => {
            const p = bj.players[id];
            if (bj.status === 'PLAYING' && bjCurrentId() === id && p && p.handIndex === handIndex) {
                p.hands[handIndex].state = 'STAND';
                bjAdvance();
                bjBroadcast();
            }
        }, BJ_TURN_SECONDS * 1000);
    }

    // Empieza la ronda cuando apostaron todos los que pueden, o al vencer el plazo de apuestas
    function bjMaybeStart(force = false) {
        if (bj.status !== 'BETTING') return;
        const ids = Object.keys(bj.players);
        const bettors = ids.filter(id => bj.players[id].mainBet > 0);
        const canBet = ids.filter(id => bj.players[id].balance >= BJ_MIN_BET || bj.players[id].mainBet > 0);
        if (!bettors.length) { clearTimeout(bjBetTimer); bjBetTimer = null; bj.betDeadline = null; return; }
        if (force || bettors.length === canBet.length) {
            clearTimeout(bjBetTimer);
            bjBetTimer = null;
            bj.betDeadline = null;
            bjStartRound();
        } else if (!bjBetTimer) {
            bj.betDeadline = Date.now() + BJ_BET_SECONDS * 1000;
            bjBetTimer = setTimeout(() => { bjBetTimer = null; bjMaybeStart(true); bjBroadcast(); }, BJ_BET_SECONDS * 1000);
        }
    }

    function bjStartRound() {
        bj.status = 'DEALING';
        bj.deck = newDeck(6);
        bj.roundPlayers = Object.keys(bj.players).filter(id => bj.players[id].mainBet > 0);
        bj.currentPlayerIndex = 0;
        for (const id of bj.roundPlayers) {
            const p = bj.players[id];
            const cards = [bj.deck.pop(), bj.deck.pop()];
            p.hands = [{ cards, bet: p.mainBet, score: scoreOf(cards), state: 'PLAYING', result: null }];
            p.handIndex = 0;
            p.state = 'PLAYING';
            if (p.sideBet > 0) {
                // Pares perfectos: mismo valor. Perfecto (mismo palo) 25:1, de color 12:1, mixto 5:1
                const [a, b] = cards;
                let mult = 0, label = '';
                if (a.value === b.value) {
                    if (a.suit === b.suit) { mult = 25; label = 'Par Perfecto'; }
                    else if (suitColor(a.suit) === suitColor(b.suit)) { mult = 12; label = 'Par de Color'; }
                    else { mult = 5; label = 'Par Mixto'; }
                }
                if (mult) {
                    p.balance += p.sideBet * (mult + 1);
                    p.sideBetResult = `¡${label}! Ganas $${p.sideBet * mult}`;
                } else {
                    p.sideBetResult = 'Perdiste apuesta lateral';
                }
            }
        }
        bj.dealerCards = [bj.deck.pop(), bj.deck.pop()];
        // Pausa para que se vea el reparto carta por carta en los navegadores
        const dealMs = (bj.roundPlayers.length + 1) * 2 * BJ_DEAL_CARD_MS + 500;
        clearTimeout(bjDealerTimer);
        bjDealerTimer = setTimeout(() => {
            bj.status = 'PLAYING';
            // Si el crupier tiene blackjack, la mano termina de inmediato
            if (isNatural(bj.dealerCards)) return bjPlayDealer();
            bjAdvance(true);
            bjBroadcast();
        }, dealMs);
    }

    // Busca la siguiente mano que todavía se puede jugar (21 o ases divididos se plantan solos)
    function bjAdvance(fromStart = false) {
        let first = fromStart;
        while (bj.currentPlayerIndex < bj.roundPlayers.length) {
            const p = bj.players[bjCurrentId()];
            if (p) {
                if (!first && p.hands[p.handIndex]?.state !== 'PLAYING') p.handIndex++;
                while (p.handIndex < p.hands.length) {
                    const h = p.hands[p.handIndex];
                    if (h.state === 'PLAYING' && h.score < 21) return bjScheduleTurn();
                    if (h.state === 'PLAYING') h.state = 'STAND';
                    p.handIndex++;
                }
                p.state = 'DONE';
            }
            first = true;   // el siguiente jugador empieza en su primera mano
            bj.currentPlayerIndex++;
        }
        bjPlayDealer();
    }

    // El crupier da vuelta su carta oculta y luego pide de a una, con pausas (suspenso)
    function bjPlayDealer() {
        clearTimeout(bjTurnTimer);
        bj.status = 'DEALER_TURN';
        bjBroadcast();
        const someoneAlive = bj.roundPlayers.some(id => bj.players[id]?.hands.some(h => h.state !== 'BUST'));
        const step = () => {
            if (someoneAlive && scoreOf(bj.dealerCards) < 17) {
                bj.dealerCards.push(bj.deck.pop());
                bjBroadcast();
                bjDealerTimer = setTimeout(step, BJ_DEALER_DRAW_MS);
            } else {
                bjDealerTimer = setTimeout(bjResolve, 700);
            }
        };
        clearTimeout(bjDealerTimer);
        bjDealerTimer = setTimeout(step, 1200);   // tiempo para ver la carta oculta
    }

    function bjResolve() {
        bj.status = 'RESOLUTION';
        const dealer = scoreOf(bj.dealerCards);
        const dealerNatural = isNatural(bj.dealerCards);
        for (const id of bj.roundPlayers) {
            const p = bj.players[id];
            if (!p) continue;   // se fue durante la mano: su apuesta queda en la mesa
            const split = p.hands.length > 1;   // tras dividir, 21 con dos cartas no es blackjack
            for (const h of p.hands) {
                const natural = !split && isNatural(h.cards);
                if (h.state === 'BUST') h.result = 'LOST';
                else if (natural && !dealerNatural) { p.balance += h.bet * 2.5; h.result = 'WON_BLACKJACK'; }   // paga 3:2
                else if (natural && dealerNatural) { p.balance += h.bet; h.result = 'PUSH'; }
                else if (dealerNatural) h.result = 'LOST';
                else if (dealer > 21 || h.score > dealer) { p.balance += h.bet * 2; h.result = 'WON'; }
                else if (h.score === dealer) { p.balance += h.bet; h.result = 'PUSH'; }
                else h.result = 'LOST';
            }
            p.balance = Math.floor(p.balance);
            p.state = p.hands.length === 1 ? p.hands[0].result : 'SPLIT_DONE';
            p.mainBet = 0;
            p.sideBet = 0;
        }
        bjBroadcast();
        clearTimeout(bjResetTimer);
        bjResetTimer = setTimeout(() => {
            bj.dealerCards = [];
            bj.roundPlayers = [];
            const ids = Object.keys(bj.players);
            for (const id of ids) Object.assign(bj.players[id], { hands: [], handIndex: 0, state: 'WAITING', sideBetResult: null });
            // Si todos quedaron sin fichas, se recarga la mesa
            if (ids.length && ids.every(id => bj.players[id].balance < BJ_MIN_BET)) {
                ids.forEach(id => { bj.players[id].balance = START_BALANCE; });
            }
            bj.status = ids.length ? 'BETTING' : 'WAITING';
            bjBroadcast();
        }, 5000);
    }

    function bjJoin(socket) {
        socket.join('blackjack');
        if (!bj.players[socket.id]) {
            const used = Object.values(bj.players).map(p => p.seat);
            bj.players[socket.id] = {
                id: socket.id, name: socket.playerName || 'Jugador', balance: START_BALANCE,
                seat: [3, 2, 4, 1, 5, 0, 6].find(s => !used.includes(s)) ?? Object.keys(bj.players).length,
                mainBet: 0, sideBet: 0, hands: [], handIndex: 0, state: 'WAITING', sideBetResult: null,
            };
        }
        if (bj.status === 'WAITING') bj.status = 'BETTING';
        bjBroadcast();
    }

    function bjLeave(id) {
        if (!bj.players[id]) return;
        const wasTurn = bj.status === 'PLAYING' && bjCurrentId() === id;
        delete bj.players[id];
        if (!Object.keys(bj.players).length) {
            [bjBetTimer, bjTurnTimer, bjDealerTimer, bjResetTimer].forEach(clearTimeout);
            bjBetTimer = null;
            Object.assign(bj, { status: 'WAITING', dealerCards: [], roundPlayers: [], currentPlayerIndex: 0, betDeadline: null });
        } else if (wasTurn) {
            bj.currentPlayerIndex++;
            bjAdvance(true);
        } else if (bj.status === 'BETTING') {
            bjMaybeStart();
        }
        bjBroadcast();
    }

    function bjHandle(id, type, data) {
        const p = bj.players[id];
        if (!p) return;
        if (type === 'placeBet') {
            if (bj.status !== 'BETTING' || p.mainBet > 0 || !data) return;
            const main = amountOf(data.mainBet), side = amountOf(data.sideBet ?? 0);
            if (main === null || side === null || main < BJ_MIN_BET || main + side > p.balance) return;
            Object.assign(p, { mainBet: main, sideBet: side, state: 'BETTING', sideBetResult: null });
            p.balance -= main + side;
            bjMaybeStart();
            return bjBroadcast();
        }
        const h = bjCurrentHand();
        if (bj.status !== 'PLAYING' || bjCurrentId() !== id || !h || h.state !== 'PLAYING') return;
        if (type === 'hit') {
            h.cards.push(bj.deck.pop());
            h.score = scoreOf(h.cards);
            if (h.score > 21) h.state = 'BUST';
            else if (h.score === 21) h.state = 'STAND';
            if (h.state !== 'PLAYING') bjAdvance(); else bjScheduleTurn();
        } else if (type === 'stand') {
            h.state = 'STAND';
            bjAdvance();
        } else if (type === 'doubleDown') {
            if (h.cards.length !== 2 || h.splitAces || p.balance < h.bet) return;
            p.balance -= h.bet;
            p.mainBet += h.bet;
            h.bet *= 2;
            h.doubled = true;
            h.cards.push(bj.deck.pop());
            h.score = scoreOf(h.cards);
            h.state = h.score > 21 ? 'BUST' : 'STAND';
            bjAdvance();
        } else if (type === 'split') {
            // Dividir: dos cartas del mismo valor; cada una forma una mano nueva con la misma apuesta
            if (h.cards.length !== 2 || pointValue(h.cards[0]) !== pointValue(h.cards[1])) return;
            if (p.hands.length >= MAX_HANDS || p.balance < h.bet) return;
            p.balance -= h.bet;
            p.mainBet += h.bet;
            const aces = h.cards[0].value === 'A';
            const second = { cards: [h.cards.pop()], bet: h.bet, state: 'PLAYING', result: null, splitAces: aces };
            h.cards.push(bj.deck.pop());
            second.cards.push(bj.deck.pop());
            h.score = scoreOf(h.cards);
            second.score = scoreOf(second.cards);
            h.splitAces = aces;
            // Los ases divididos reciben una sola carta cada uno
            if (aces) { h.state = 'STAND'; second.state = 'STAND'; }
            p.hands.splice(p.handIndex + 1, 0, second);
            if (h.state !== 'PLAYING' || h.score >= 21) { if (h.state === 'PLAYING') h.state = 'STAND'; bjAdvance(); }
            else bjScheduleTurn();
        } else return;
        bjBroadcast();
    }

    // ======================= POKER =======================
    const pk = {
        status: 'WAITING', players: {}, communityCards: [], deck: [], pot: 0, highestBet: 0,
        roundPlayers: [], currentPlayerIndex: 0, dealerIndex: -1, minBet: POKER_MIN_BET, lastRaise: POKER_MIN_BET,
    };
    let pkTurnTimer = null, pkNextTimer = null;
    const pkInHand = () => ['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(pk.status);

    function pkBroadcast() {
        const sockets = io.sockets.adapter.rooms.get('poker');
        if (!sockets) return;
        for (const sid of sockets) {
            const personal = JSON.parse(JSON.stringify({ ...pk, deck: undefined }));
            for (const pid in personal.players) {
                if (pid !== sid && personal.status !== 'SHOWDOWN') {
                    personal.players[pid].cards = personal.players[pid].cards.map(() => ({ hidden: true }));
                }
            }
            io.to(sid).emit('pokerGameState', personal);
        }
    }

    function pkScheduleTurn() {
        clearTimeout(pkTurnTimer);
        if (!pkInHand()) return;
        const id = pk.roundPlayers[pk.currentPlayerIndex];
        pkTurnTimer = setTimeout(() => {
            if (!pkInHand() || pk.roundPlayers[pk.currentPlayerIndex] !== id) return;
            const p = pk.players[id];
            pkAct(id, { action: p && p.currentRoundBet >= pk.highestBet ? 'call' : 'fold' });
        }, POKER_TURN_SECONDS * 1000);
    }

    function pkStartRound() {
        const eligible = Object.keys(pk.players).filter(id => pk.players[id].balance > 0);
        if (eligible.length < 2) { pk.status = 'WAITING'; return pkBroadcast(); }
        pk.roundPlayers = eligible;
        const n = eligible.length;
        pk.dealerIndex = (pk.dealerIndex + 1) % n;
        // Mano de dos: el que reparte pone la ciega chica y habla primero antes del flop
        const sbIndex = n === 2 ? pk.dealerIndex : (pk.dealerIndex + 1) % n;
        const bbIndex = (sbIndex + 1) % n;
        Object.assign(pk, { pot: 0, communityCards: [], deck: newDeck(1), highestBet: pk.minBet, lastRaise: pk.minBet });
        for (const id of eligible) {
            Object.assign(pk.players[id], {
                cards: [pk.deck.pop(), pk.deck.pop()], currentRoundBet: 0, totalHandBet: 0,
                state: 'PLAYING', actedThisRound: false, handDescription: '',
            });
        }
        const blind = (index, amount) => {
            const p = pk.players[eligible[index]];
            const pay = Math.min(amount, p.balance);
            p.balance -= pay;
            p.currentRoundBet = pay;
            pk.pot += pay;
            if (p.balance === 0) p.state = 'ALL_IN';
        };
        blind(sbIndex, pk.minBet / 2);
        blind(bbIndex, pk.minBet);
        pk.currentPlayerIndex = (bbIndex + 1) % n;
        pk.status = 'PREFLOP';
        pkCheckTurn();
    }

    function pkCheckTurn() {
        const alive = pk.roundPlayers.filter(id => pk.players[id].state !== 'FOLDED');
        if (alive.length === 1) return pkEndByFold(alive[0]);
        const pending = alive.some(id => {
            const p = pk.players[id];
            return p.state === 'PLAYING' && (!p.actedThisRound || p.currentRoundBet < pk.highestBet);
        });
        if (!pending) return pkNextStage();
        for (let i = 0; i < pk.roundPlayers.length; i++) {
            const p = pk.players[pk.roundPlayers[pk.currentPlayerIndex]];
            if (p.state === 'PLAYING') break;
            pk.currentPlayerIndex = (pk.currentPlayerIndex + 1) % pk.roundPlayers.length;
        }
        pkScheduleTurn();
        pkBroadcast();
    }

    function pkCollectBets() {
        for (const id of pk.roundPlayers) {
            const p = pk.players[id];
            p.totalHandBet += p.currentRoundBet;
            p.currentRoundBet = 0;
            if (p.state === 'PLAYING') p.actedThisRound = false;
        }
        pk.highestBet = 0;
        pk.lastRaise = pk.minBet;
    }

    function pkNextStage() {
        pkCollectBets();
        const n = pk.roundPlayers.length;
        // Después del flop habla primero el primero activo a la izquierda del que reparte
        pk.currentPlayerIndex = (pk.dealerIndex + 1) % n;
        const draw = k => { for (let i = 0; i < k; i++) pk.communityCards.push(pk.deck.pop()); };
        if (pk.status === 'PREFLOP') { pk.status = 'FLOP'; draw(3); }
        else if (pk.status === 'FLOP') { pk.status = 'TURN'; draw(1); }
        else if (pk.status === 'TURN') { pk.status = 'RIVER'; draw(1); }
        else return pkShowdown();
        // Si ya nadie puede apostar (todos all-in menos uno), se reparten las cartas que faltan
        const canAct = pk.roundPlayers.filter(id => pk.players[id].state === 'PLAYING');
        if (canAct.length <= 1) return pkNextStage();
        pkCheckTurn();
    }

    function pkEndByFold(winnerId) {
        clearTimeout(pkTurnTimer);
        pkCollectBets();
        pk.status = 'SHOWDOWN';
        pk.players[winnerId].balance += pk.pot;
        pk.players[winnerId].handDescription = '🏆 Ganador (todos se retiraron)';
        pkBroadcast();
        pkScheduleNext(5000);
    }

    // Reparto con botes laterales: cada jugador solo puede ganar hasta lo que él mismo apostó
    function pkShowdown() {
        clearTimeout(pkTurnTimer);
        pk.status = 'SHOWDOWN';
        const board = pk.communityCards.map(solverCard);
        const contrib = {};
        for (const id of pk.roundPlayers) contrib[id] = pk.players[id].totalHandBet;
        const alive = pk.roundPlayers.filter(id => pk.players[id].state !== 'FOLDED');
        const hands = {};
        for (const id of alive) {
            const h = Hand.solve(pk.players[id].cards.map(solverCard).concat(board));
            h.id = id;
            hands[id] = h;
            pk.players[id].handDescription = h.descr;
        }
        const levels = [...new Set(alive.map(id => contrib[id]))].sort((a, b) => a - b);
        let prev = 0;
        const winnersAll = new Set();
        for (const level of levels) {
            let amount = 0;
            for (const id of pk.roundPlayers) amount += Math.max(0, Math.min(contrib[id], level) - prev);
            const eligible = alive.filter(id => contrib[id] >= level);
            prev = level;
            if (!amount || !eligible.length) continue;
            const winners = Hand.winners(eligible.map(id => hands[id])).map(h => h.id);
            const share = Math.floor(amount / winners.length);
            winners.forEach(id => { pk.players[id].balance += share; winnersAll.add(id); });
            // La ficha que sobra de un empate va al primer ganador a la izquierda del que reparte
            const n = pk.roundPlayers.length;
            const order = pk.roundPlayers.map((_, i) => pk.roundPlayers[(pk.dealerIndex + 1 + i) % n]);
            pk.players[order.find(id => winners.includes(id))].balance += amount - share * winners.length;
        }
        for (const id of winnersAll) pk.players[id].handDescription = '🏆 ' + pk.players[id].handDescription;
        pkBroadcast();
        pkScheduleNext(8000);
    }

    function pkScheduleNext(ms) {
        clearTimeout(pkNextTimer);
        pkNextTimer = setTimeout(() => {
            // Quienes se fueron durante la mano salen recién ahora
            for (const id of Object.keys(pk.players)) if (pk.players[id].left) delete pk.players[id];
            const ids = Object.keys(pk.players);
            for (const id of ids) {
                Object.assign(pk.players[id], { cards: [], currentRoundBet: 0, totalHandBet: 0, state: 'WAITING', handDescription: '' });
            }
            // Recompra: quien quedó sin fichas recibe un nuevo saldo para seguir jugando
            for (const id of ids) if (pk.players[id].balance < pk.minBet) pk.players[id].balance = START_BALANCE;
            Object.assign(pk, { communityCards: [], pot: 0, roundPlayers: [] });
            pkStartRound();
        }, ms);
    }

    function pkAct(id, data) {
        const p = pk.players[id];
        if (!p || !data || !pkInHand() || pk.roundPlayers[pk.currentPlayerIndex] !== id || p.state !== 'PLAYING') return;
        const putIn = amount => {
            const pay = Math.min(amount, p.balance);
            p.balance -= pay;
            p.currentRoundBet += pay;
            pk.pot += pay;
            if (p.balance === 0) p.state = 'ALL_IN';
        };
        if (data.action === 'fold') {
            p.state = 'FOLDED';
        } else if (data.action === 'call') {
            putIn(pk.highestBet - p.currentRoundBet);
        } else if (data.action === 'raise') {
            // Subida mínima: la ciega grande o la última subida; con menos solo se puede ir all-in
            const raise = amountOf(data.amount);
            if (raise === null || raise <= 0) return;
            const toCall = pk.highestBet - p.currentRoundBet;
            const allIn = toCall + raise >= p.balance;
            if (raise < pk.lastRaise && !allIn) return;
            putIn(toCall + raise);
            if (p.currentRoundBet > pk.highestBet) {
                const raisedBy = p.currentRoundBet - pk.highestBet;
                if (raisedBy >= pk.lastRaise) pk.lastRaise = raisedBy;
                pk.highestBet = p.currentRoundBet;
                for (const other of pk.roundPlayers) {
                    if (other !== id && pk.players[other].state === 'PLAYING') pk.players[other].actedThisRound = false;
                }
            }
        } else return;
        p.actedThisRound = true;
        pk.currentPlayerIndex = (pk.currentPlayerIndex + 1) % pk.roundPlayers.length;
        pkCheckTurn();
    }

    function pkJoin(socket) {
        socket.join('poker');
        if (!pk.players[socket.id]) {
            pk.players[socket.id] = {
                id: socket.id, name: socket.playerName || 'Jugador', balance: START_BALANCE,
                cards: [], currentRoundBet: 0, totalHandBet: 0, state: 'WAITING', actedThisRound: false, handDescription: '',
            };
        }
        pkBroadcast();
    }

    function pkLeave(id) {
        const p = pk.players[id];
        if (!p) return;
        if (pkInHand() && pk.roundPlayers.includes(id)) {
            // Se retira de la mano; lo que apostó queda en el bote y sale al terminar la mano
            p.left = true;
            const wasTurn = pk.roundPlayers[pk.currentPlayerIndex] === id;
            if (p.state !== 'FOLDED') p.state = 'FOLDED';
            if (wasTurn) pk.currentPlayerIndex = (pk.currentPlayerIndex + 1) % pk.roundPlayers.length;
            pkCheckTurn();
            return;
        }
        if (pk.status === 'SHOWDOWN' && pk.roundPlayers.includes(id)) { p.left = true; return pkBroadcast(); }
        delete pk.players[id];
        if (!Object.keys(pk.players).length) {
            clearTimeout(pkTurnTimer);
            clearTimeout(pkNextTimer);
            Object.assign(pk, { status: 'WAITING', roundPlayers: [], communityCards: [], pot: 0, dealerIndex: -1 });
        }
        pkBroadcast();
    }

    return {
        join(socket, room) {
            if (room === 'blackjack') bjJoin(socket);
            else if (room === 'poker') pkJoin(socket);
        },
        leave(id) { bjLeave(id); pkLeave(id); },
        blackjack(id, type, data) { bjHandle(id, type, data); },
        startPoker(id) { if (pk.players[id] && pk.status === 'WAITING') pkStartRound(); },
        poker(id, data) { pkAct(id, data); },
    };
};
