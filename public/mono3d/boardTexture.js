// Textura impresa del tablero del Monopoly (cara superior de la losa 3D).
//
// drawBoard(ctx, size, state) pinta el tablero completo en un lienzo 2D de size x size píxeles con el
// mismo mapeo lienzo <-> mundo de layout.js (x = px / W * BOARD_SIZE - HALF, z = py / H * BOARD_SIZE - HALF).
// Internamente se dibuja en unidades del mundo (1 = ancho de una casilla) gracias a setTransform, así que
// cellRect(), JAIL_BOX, CENTER_RECT, etc. se usan tal cual.
// Las casas y hoteles NO se dibujan aquí: son mallas 3D (buildings.js).
//
// boardSignature(state) resume lo único que cambia el dibujo durante la partida (dueños, su color e
// hipotecas) para que la escena redibuje la textura solo cuando hace falta.
//
// warmBoardTexture(size) (opcional) prepara en tiempo ocioso los emojis en caché, para que el primer
// dibujo no pague la rasterización en frío de las fuentes de emojis a color.

import {
    BOARD_SIZE, HALF, BAND,
    CENTER_RECT, CHEST_SLOT, CHANCE_SLOT, DICE_AREA, JAIL_BOX, cellRect,
} from './layout.js';

// ---------------------------------------------------------------------------
// Paleta, íconos y tipografías
// ---------------------------------------------------------------------------
const MINT = '#cfe6d2';
const INK = '#161616';
const RED = '#e2231a';
const DARK_RED = '#4a0905';
const ORANGE = '#f7941d';
const BLUE = '#0072bb';
const OWNER_FALLBACK = '#8a8a8a';
const GO_SALARY = 200;

const GROUP_COLORS = {
    brown: '#955436', lightblue: '#aae0fa', purple: '#d93a96', orange: '#f7941d',
    red: '#ed1b24', yellow: '#fef200', green: '#1fb25a', darkblue: '#0072bb',
};

const PROPERTY_ICONS = {
    1: '🏚️', 3: '🧱', 6: '🛣️', 8: '🌳', 9: '⛲', 11: '🏬', 13: '🖼️', 14: '🛍️',
    16: '🧺', 18: '🎭', 19: '🏛️', 21: '🌆', 23: '🌊', 24: '🏝️', 26: '⛵', 27: '🎰',
    29: '⛳', 31: '🏳️', 32: '📈', 34: '🏙️', 37: '🏰', 39: '👑',
};
const UTILITY_ICONS = { 12: '💡', 28: '🚰' };
const RAILROAD_ICON = '🚂';
const CHEST_ICON = '🧰';
const POLICE_ICON = '👮';
const TAX_ICONS = { income: '💰', luxury: '💍' };
// Tamaño (en unidades) de cada emoji impreso; warmBoardTexture los prepara con estos mismos valores
const ICON_SIZE = { street: 0.36, railroad: 0.5, utility: 0.48, chest: 0.46, tax: 0.42, police: 0.62, slot: 0.62 };

const OWNABLE = new Set(['property', 'railroad', 'utility']);
// Tipo de cada esquina según su posición (sirve aunque todavía no llegue el estado)
const CORNER_TYPES = { 0: 'go', 10: 'jail', 20: 'parking', 30: 'goToJail' };

const FONT_HEAVY = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif';
const FONT_SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const FONT_SERIF = 'Georgia, "Times New Roman", serif';
const FONT_EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

// Degradados metálicos (paradas del degradado)
const GOLD_TEXT = [[0, '#d9a932'], [0.45, '#a8780a'], [0.55, '#8a6200'], [1, '#4e3500']];
const GOLD_LINE = [[0, '#8a6400'], [0.3, '#f5d77a'], [0.55, '#b8860b'], [0.78, '#fff0b3'], [1, '#9a7200']];
const SILVER_LINE = [[0, '#8f98a3'], [0.35, '#e9edf1'], [0.6, '#a9b1bc'], [0.85, '#f4f6f8'], [1, '#848d99']];

// El texto se escribe en un marco escalado x100 para no usar tamaños de fuente menores a 1px
const TXT = 100;
const SQ = Math.SQRT1_2;

// ---------------------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------------------

// Generador pseudoaleatorio con semilla (mulberry32): el dibujo sale idéntico en cada llamada
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Lienzo auxiliar fuera de pantalla (OffscreenCanvas si existe; si no, un <canvas> del documento).
// willReadFrequently lo deja en memoria (CPU): copiar un lienzo acelerado por GPU a otro lienzo obliga a
// leerlo de vuelta de la GPU en cada redibujo, y eso cuesta decenas de milisegundos.
const AUX_CANVAS_OPTS = { willReadFrequently: true };
function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            const canvas = new OffscreenCanvas(w, h);
            const g = canvas.getContext('2d', AUX_CANVAS_OPTS);
            if (g) return { canvas, g };
        } catch { /* se usa el lienzo del documento */ }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return { canvas, g: canvas.getContext('2d', AUX_CANVAS_OPTS) };
}

function linearGradient(ctx, x0, y0, x1, y1, stops) {
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [k, c] of stops) grad.addColorStop(k, c);
    return grad;
}

function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
}

function starPath(ctx, x, y, outer, inner = outer * 0.45, points = 5) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a = -Math.PI / 2 + i * Math.PI / points;
        const r = i % 2 ? inner : outer;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
}

function strokeLine(ctx, x0, y0, x1, y1, width, style) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
}

// Marco rectangular metido `inset` hacia adentro del rectángulo (x, y, w, h)
function strokeInset(ctx, x, y, w, h, inset, width, style) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
}

// Nivel de lujo según el precio: 1 humilde … 4 lujo (0 = no es calle)
function tierOf(cell) {
    if (!cell || cell.type !== 'property') return 0;
    const price = cell.price || 0;
    if (price >= 350) return 4;
    if (price >= 220) return 3;
    if (price >= 140) return 2;
    return 1;
}

// Coordenadas a lo largo de la diagonal del cartel central (t, de abajo-izquierda a arriba-derecha)
// y perpendicular a ella (p, hacia abajo-derecha)
const toTP = (x, z) => ({ t: (x - z) * SQ, p: (x + z) * SQ });
const fromTP = (t, p) => ({ x: (t + p) * SQ, z: (p - t) * SQ });

// Ejecuta fn en el marco local de una casilla: origen en su centro, girado con canvasAngle para que el
// borde exterior quede abajo (+y local). fn recibe el medio ancho (a lo largo del borde) y el medio alto
// (profundidad hacia el centro del tablero).
function inCell(ctx, r, fn) {
    const vertical = r.side === 'left' || r.side === 'right';
    const lw = vertical ? r.d : r.w;
    const lh = vertical ? r.w : r.d;
    ctx.save();
    ctx.translate(r.cx, r.cz);
    ctx.rotate(r.canvasAngle);
    fn(lw / 2, lh / 2);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function setFont(ctx, size, family, weight = 'bold', style = '', spacing = 0) {
    ctx.font = `${style} ${weight} ${(size * TXT).toFixed(2)}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(spacing * TXT).toFixed(2)}px`;
}

// Reparte las palabras en líneas que no superen maxPx (medido con la fuente actual)
function wrapWords(ctx, words, maxPx) {
    const lines = [];
    let current = '';
    for (const word of words) {
        const probe = current ? `${current} ${word}` : word;
        if (!current || ctx.measureText(probe).width <= maxPx) current = probe;
        else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
}

// Busca el mayor tamaño de letra (<= maxSize) con el que el texto entra en una caja de maxW x maxH,
// partiéndolo en hasta maxLines líneas. El resultado se guarda en caché (las fuentes son del sistema).
const fitCache = new Map();
function fitText(ctx, str, maxW, maxH, o) {
    const maxLines = o.maxLines ?? 1;
    const lineHeight = o.lineHeight ?? 1.08;
    const minSize = o.minSize ?? o.maxSize * 0.5;
    const key = [str, maxW, maxH, o.font, o.weight, o.style, o.maxSize, minSize, maxLines, lineHeight, o.spacing].join('|');
    const hit = fitCache.get(key);
    if (hit) return hit;

    const words = String(str).split(/\s+/).filter(Boolean);
    const maxPx = maxW * TXT;
    const wrap = () => (maxLines === 1 ? [words.join(' ')] : wrapWords(ctx, words, maxPx));

    ctx.save();
    let result = null;
    for (let size = o.maxSize; size >= minSize - 1e-9; size *= 0.94) {
        setFont(ctx, size, o.font, o.weight, o.style, o.spacing);
        const lines = wrap();
        if (lines.length > maxLines || lines.length * size * lineHeight > maxH) continue;
        if (lines.some(line => ctx.measureText(line).width > maxPx)) continue;
        result = { lines, size };
        break;
    }
    if (!result) {
        // Último recurso: tamaño mínimo; lo que sobre se junta en la última línea y fillText lo angosta
        setFont(ctx, minSize, o.font, o.weight, o.style, o.spacing);
        const lines = wrap();
        result = {
            lines: lines.length > maxLines ? [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')] : lines,
            size: minSize,
        };
    }
    ctx.restore();
    if (!result.lines.length) result.lines = [''];
    fitCache.set(key, result);
    return result;
}

// Escribe una línea de texto en (x, y) (unidades del mundo, en el marco actual).
// Opciones: size, font, weight, style, spacing, color | gradient (paradas), stroke + strokeWidth,
// shadow { color, blur, x, y } (en unidades), maxWidth, align, baseline, alpha.
function drawText(R, str, x, y, o) {
    const { ctx } = R;
    ctx.save();
    ctx.scale(1 / TXT, 1 / TXT);
    setFont(ctx, o.size, o.font || FONT_SANS, o.weight || 'bold', o.style || '', o.spacing || 0);
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    const X = x * TXT, Y = y * TXT;
    const mw = o.maxWidth ? o.maxWidth * TXT : 0;
    if (o.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = o.strokeWidth * TXT;
        ctx.strokeStyle = o.stroke;
        if (mw) ctx.strokeText(str, X, Y, mw); else ctx.strokeText(str, X, Y);
    }
    if (o.shadow) {
        // Las sombras del lienzo no siguen la transformación: van en píxeles
        ctx.shadowColor = o.shadow.color;
        ctx.shadowBlur = (o.shadow.blur || 0) * R.s;
        ctx.shadowOffsetX = (o.shadow.x || 0) * R.s;
        ctx.shadowOffsetY = (o.shadow.y || 0) * R.s;
    }
    const half = o.size * TXT * 0.5;
    ctx.fillStyle = o.gradient ? linearGradient(ctx, 0, Y - half, 0, Y + half, o.gradient) : (o.color || INK);
    if (mw) ctx.fillText(str, X, Y, mw); else ctx.fillText(str, X, Y);
    ctx.restore();
}

// Bloque de texto ajustado a una caja (ancho maxW, alto maxH, empieza en y = top), centrado en ambos ejes
function textBlock(R, str, cx, top, maxW, maxH, o) {
    const fit = fitText(R.ctx, str, maxW, maxH, o);
    const lh = fit.size * (o.lineHeight ?? 1.08);
    let y = top + (maxH - lh * fit.lines.length) / 2 + lh / 2;
    for (const line of fit.lines) {
        drawText(R, line, cx, y, { ...o, size: fit.size, maxWidth: maxW });
        y += lh;
    }
    return fit;
}

// Una línea ajustada al ancho: devuelve el tamaño usado
function fittedLine(R, str, x, y, maxW, o) {
    const fit = fitText(R.ctx, str, maxW, o.maxSize * 1.5, { ...o, maxLines: 1 });
    drawText(R, str, x, y, { ...o, size: fit.size, maxWidth: maxW });
    return fit.size;
}

// Emojis como sprites en caché. Los emojis a color (fuentes COLR) son muy caros de rasterizar y, girados
// o con sombra, el lienzo los vuelve a dibujar en cada llamada; así se rasterizan una sola vez por
// tamaño en píxeles (con la sombra ya aplicada) y luego solo se copian con drawImage.
const emojiCache = new Map();
function emojiSprite(ch, px, shadow) {
    const key = `${ch}|${px}|${shadow ? 1 : 0}`;
    const hit = emojiCache.get(key);
    if (hit) return hit;
    const pad = Math.ceil(px * 0.18);
    const side = Math.ceil(px * 1.3) + pad * 2;
    const glyph = makeCanvas(side, side);
    glyph.g.font = `${px}px ${FONT_EMOJI}`;
    glyph.g.textAlign = 'center';
    glyph.g.textBaseline = 'middle';
    glyph.g.fillStyle = INK;
    glyph.g.fillText(ch, side / 2, side / 2);
    let canvas = glyph.canvas;
    if (shadow) {
        // La sombra se aplica a la imagen ya rasterizada (barato), no al texto
        const out = makeCanvas(side, side);
        out.g.shadowColor = 'rgba(0, 0, 0, 0.32)';
        out.g.shadowBlur = px * 0.075;
        out.g.shadowOffsetY = px * 0.04;
        out.g.drawImage(glyph.canvas, 0, 0);
        canvas = out.canvas;
        out.g.getImageData(0, 0, 1, 1);   // rasteriza ahora (lienzo en CPU: es barato)
    } else {
        glyph.g.getImageData(0, 0, 1, 1);
    }
    const sprite = { canvas, side };
    emojiCache.set(key, sprite);
    return sprite;
}

function drawEmoji(R, ch, x, y, size, { alpha, shadow = true } = {}) {
    const { ctx } = R;
    const px = Math.max(8, Math.round(size * R.s));
    const sprite = emojiSprite(ch, px, shadow);
    const w = sprite.side / R.s;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    ctx.drawImage(sprite.canvas, x - w / 2, y - w / 2, w, w);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Patrones fijos en caché: grano del papel y mármol
// ---------------------------------------------------------------------------

// Grano del papel: unos miles de puntitos casi transparentes en posiciones fijas (PRNG con semilla).
// Se agrupan por tono en pocos trazados, así cada redibujo son solo unas pocas llamadas a fill().
const GRAIN_TONES = [
    'rgba(28, 58, 38, 0.05)', 'rgba(28, 58, 38, 0.08)', 'rgba(28, 58, 38, 0.12)',
    'rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.18)',
];
const GRAIN_DOTS = 7000;
let grainCache = null;
function grainDots() {
    if (grainCache) return grainCache;
    const rnd = mulberry32(0x5eed);
    const buckets = GRAIN_TONES.map(() => []);
    for (let i = 0; i < GRAIN_DOTS; i++) {
        const x = rnd() * BOARD_SIZE - HALF, z = rnd() * BOARD_SIZE - HALF;
        const d = 0.005 + rnd() * 0.009;
        const tone = rnd() < 0.62 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 2);
        buckets[tone].push(x, z, d);
    }
    grainCache = buckets.map(list => Float32Array.from(list));
    return grainCache;
}

// Mármol procedural (vetas suaves y algunas doradas) para las calles más caras
const marbleCache = new Map();
function marbleTile(seed, wpx, hpx) {
    const key = `${seed}:${wpx}x${hpx}`;
    const hit = marbleCache.get(key);
    if (hit) return hit;
    const { canvas, g } = makeCanvas(wpx, hpx);
    const rnd = mulberry32(seed);
    const S = wpx / 100;   // 100 = ancho de la casilla

    g.fillStyle = linearGradient(g, 0, 0, wpx, hpx,
        [[0, '#fdfaf3'], [0.45, '#f1e8d5'], [0.62, '#fcf8ef'], [1, '#ebdfc5']]);
    g.fillRect(0, 0, wpx, hpx);

    // Nubes suaves de color
    for (let i = 0; i < 9; i++) {
        const x = rnd() * wpx, y = rnd() * hpx, r = (30 + rnd() * 50) * S;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const light = rnd() < 0.5;
        const tone = light ? '255, 255, 255' : '176, 156, 122';
        grad.addColorStop(0, `rgba(${tone}, ${light ? 0.55 : 0.14})`);
        grad.addColorStop(1, `rgba(${tone}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, wpx, hpx);
    }

    // Vetas: recorridos aleatorios suavizados, primero un halo ancho y luego la línea fina
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const vein = (pts, width, style) => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
            g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        g.lineWidth = width;
        g.strokeStyle = style;
        g.stroke();
    };
    for (let v = 0; v < 8; v++) {
        let x = rnd() * wpx * 0.8 - wpx * 0.2, y = rnd() * hpx * 0.6 - hpx * 0.1;
        let ang = 0.55 + (rnd() - 0.5) * 1.1;
        const pts = [];
        for (let k = 0; k < 16; k++) {
            pts.push([x, y]);
            ang += (rnd() - 0.5) * 0.8;
            const step = (8 + rnd() * 10) * S;
            x += Math.cos(ang) * step;
            y += Math.sin(ang) * step;
        }
        const gold = rnd() < 0.3;
        vein(pts, (3 + rnd() * 5) * S, gold ? 'rgba(200, 160, 70, 0.10)' : 'rgba(140, 126, 104, 0.09)');
        vein(pts, (0.5 + rnd() * 1.1) * S, gold ? 'rgba(186, 142, 48, 0.55)' : 'rgba(104, 92, 76, 0.32)');
        // Ramita que sale de la veta
        const from = Math.floor(rnd() * (pts.length - 4));
        let bx = pts[from][0], by = pts[from][1], ba = ang + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6);
        const branch = [];
        for (let k = 0; k < 6; k++) {
            branch.push([bx, by]);
            ba += (rnd() - 0.5) * 0.6;
            bx += Math.cos(ba) * 7 * S;
            by += Math.sin(ba) * 7 * S;
        }
        vein(branch, 0.45 * S, 'rgba(110, 98, 80, 0.25)');
    }
    marbleCache.set(key, canvas);
    return canvas;
}

// ---------------------------------------------------------------------------
// Fondo de las casillas (antes del grano del papel)
// ---------------------------------------------------------------------------
function drawCellBackground(R, pos) {
    const cell = R.board[pos];
    const tier = tierOf(cell);
    if (!tier) return;   // el resto de las casillas queda del verde menta del tablero
    const { ctx } = R;
    inCell(ctx, cellRect(pos), (hw, hh) => {
        if (tier === 4) {
            const tile = marbleTile(0x9e37 + pos * 7919, Math.max(8, Math.round(hw * 2 * R.s)), Math.max(8, Math.round(hh * 2 * R.s)));
            ctx.drawImage(tile, -hw, -hh, hw * 2, hh * 2);
            return;
        }
        if (tier === 3) {
            ctx.fillStyle = linearGradient(ctx, -hw, -hh, hw, hh,
                [[0, '#ffffff'], [0.45, '#e4e8ed'], [0.62, '#fafbfc'], [1, '#d8dde4']]);
        } else {
            ctx.fillStyle = tier === 2 ? '#fbf6e8' : '#f3eedf';
        }
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    });
}

function drawGrain(R) {
    const { ctx } = R;
    grainDots().forEach((dots, tone) => {
        ctx.beginPath();
        for (let i = 0; i < dots.length; i += 3) ctx.rect(dots[i], dots[i + 1], dots[i + 2], dots[i + 2]);
        ctx.fillStyle = GRAIN_TONES[tone];
        ctx.fill();
    });
}

// ---------------------------------------------------------------------------
// Casillas de los lados (marco local: ancho a lo largo del borde, borde exterior abajo)
// ---------------------------------------------------------------------------
function drawStreet(R, cell, hw, hh) {
    const { ctx } = R;
    const tier = tierOf(cell);
    const bandBottom = -hh + BAND;
    const bodyH = hh - bandBottom;

    // Banda de color del grupo (lado interior)
    ctx.fillStyle = GROUP_COLORS[cell.group] || '#9aa3ae';
    ctx.fillRect(-hw, -hh, hw * 2, BAND);
    if (tier >= 3) {
        // Brillo satinado en las bandas de lujo
        ctx.fillStyle = linearGradient(ctx, 0, -hh, 0, bandBottom,
            [[0, 'rgba(255, 255, 255, 0.38)'], [0.55, 'rgba(255, 255, 255, 0.06)'], [1, 'rgba(0, 0, 0, 0.10)']]);
        ctx.fillRect(-hw, -hh, hw * 2, BAND);
    }
    strokeLine(ctx, -hw, bandBottom, hw, bandBottom, 0.014, INK);

    // Marcos según el nivel de lujo
    if (tier === 2) {
        strokeInset(ctx, -hw, bandBottom, hw * 2, bodyH, 0.05, 0.008, 'rgba(92, 70, 32, 0.5)');
    } else if (tier === 3) {
        strokeInset(ctx, -hw, bandBottom, hw * 2, bodyH, 0.045, 0.02, linearGradient(ctx, -hw, -hh, hw, hh, SILVER_LINE));
        strokeInset(ctx, -hw, bandBottom, hw * 2, bodyH, 0.085, 0.008, '#8c95a1');
        strokeInset(ctx, -hw, -hh, hw * 2, BAND, 0.022, 0.012, 'rgba(255, 255, 255, 0.6)');
    } else if (tier === 4) {
        const gold = linearGradient(ctx, -hw, -hh, hw, hh, GOLD_LINE);
        strokeInset(ctx, -hw, bandBottom, hw * 2, bodyH, 0.045, 0.026, gold);
        strokeInset(ctx, -hw, bandBottom, hw * 2, bodyH, 0.092, 0.009, '#8a6400');
        strokeInset(ctx, -hw, -hh, hw * 2, BAND, 0.024, 0.018, gold);
        // Estrellitas doradas
        ctx.fillStyle = linearGradient(ctx, 0, 0.39, 0, 0.47, [[0, '#ffe9a0'], [1, '#b8860b']]);
        ctx.strokeStyle = '#7a5800';
        ctx.lineWidth = 0.005;
        for (const sx of [-0.13, 0, 0.13]) {
            starPath(ctx, sx, 0.445, sx === 0 ? 0.036 : 0.028);
            ctx.fill();
            ctx.stroke();
        }
        // Placa de marfil detrás del nombre para que el dorado se lea sobre las vetas del mármol
        roundRectPath(ctx, -hw + 0.12, bandBottom + 0.07, hw * 2 - 0.24, 0.36, 0.03);
        ctx.fillStyle = 'rgba(255, 251, 238, 0.82)';
        ctx.fill();
        ctx.lineWidth = 0.006;
        ctx.strokeStyle = 'rgba(166, 124, 0, 0.85)';
        ctx.stroke();
    }

    // Nombre
    const luxe = tier >= 3;
    const inset = tier === 4 ? 0.14 : luxe ? 0.1 : 0.07;
    textBlock(R, cell.name.toUpperCase(), 0, bandBottom + 0.06, hw * 2 - inset * 2, 0.38, {
        font: luxe ? FONT_SERIF : FONT_SANS,
        weight: luxe ? 'bold' : '800',
        // Con el mínimo algo alto, una palabra larga se angosta un poco (maxWidth) en vez de achicarse
        maxSize: 0.15, minSize: 0.105, maxLines: 3, lineHeight: 1.06,
        spacing: luxe ? 0.004 : 0,
        color: tier === 3 ? '#2d3440' : '#1d1d1d',
        gradient: tier === 4 ? GOLD_TEXT : null,
        shadow: tier === 4 ? { color: 'rgba(70, 45, 0, 0.35)', blur: 0.008, y: 0.005 } : null,
    });

    // Ícono y precio
    drawEmoji(R, PROPERTY_ICONS[cell.id] || '🏠', 0, 0.2, ICON_SIZE.street);
    drawText(R, `$${cell.price}`, 0, 0.585, {
        size: 0.13,
        font: luxe ? FONT_SERIF : FONT_SANS,
        weight: luxe ? 'bold' : '800',
        color: tier === 4 ? '#8a6a00' : tier === 3 ? '#2d3440' : '#1d1d1d',
        maxWidth: hw * 2 - 0.2,
    });
}

function drawRailroad(R, cell, hw, hh) {
    textBlock(R, cell.name.toUpperCase(), 0, -hh + 0.08, hw * 2 - 0.14, 0.36, {
        font: FONT_SANS, weight: '800', maxSize: 0.14, minSize: 0.07, maxLines: 2,
    });
    drawEmoji(R, RAILROAD_ICON, 0, 0.1, ICON_SIZE.railroad);
    drawText(R, `$${cell.price}`, 0, 0.585, { size: 0.13, font: FONT_SANS, weight: '800', color: '#1d1d1d' });
}

function drawUtility(R, cell, hw, hh) {
    textBlock(R, cell.name.toUpperCase(), 0, -hh + 0.08, hw * 2 - 0.14, 0.36, {
        font: FONT_SANS, weight: '800', maxSize: 0.14, minSize: 0.07, maxLines: 2,
    });
    drawEmoji(R, UTILITY_ICONS[cell.id] || '⚙️', 0, 0.1, ICON_SIZE.utility);
    drawText(R, `$${cell.price}`, 0, 0.585, { size: 0.13, font: FONT_SANS, weight: '800', color: '#1d1d1d' });
}

function drawChance(R, hw, hh) {
    const { ctx } = R;
    fittedLine(R, 'SUERTE', 0, -hh + 0.19, hw * 2 - 0.16, { font: FONT_HEAVY, weight: '900', maxSize: 0.16, spacing: 0.006 });
    ctx.save();
    ctx.translate(0.02, 0.16);
    ctx.rotate(-0.14);
    drawText(R, '?', 0, 0, {
        size: 0.95, font: FONT_HEAVY, weight: '900', color: ORANGE,
        stroke: '#5e2a00', strokeWidth: 0.045,
        shadow: { color: 'rgba(0, 0, 0, 0.25)', blur: 0.02, y: 0.015 },
    });
    ctx.restore();
}

function drawChest(R, hw, hh) {
    textBlock(R, 'ARCA COMUNAL', 0, -hh + 0.08, hw * 2 - 0.14, 0.36, {
        font: FONT_HEAVY, weight: '900', maxSize: 0.14, minSize: 0.07, maxLines: 2, color: BLUE,
    });
    drawEmoji(R, CHEST_ICON, 0, 0.2, ICON_SIZE.chest);
}

function drawTax(R, cell, hw, hh) {
    const amount = cell.amount || 0;
    textBlock(R, cell.name.toUpperCase(), 0, -hh + 0.07, hw * 2 - 0.14, 0.42, {
        font: FONT_SANS, weight: '800', maxSize: 0.135, minSize: 0.07, maxLines: 3,
    });
    drawEmoji(R, amount <= 100 ? TAX_ICONS.luxury : TAX_ICONS.income, 0, 0.16, ICON_SIZE.tax);
    fittedLine(R, `PAGA $${amount}`, 0, 0.585, hw * 2 - 0.14, { font: FONT_SANS, weight: '800', maxSize: 0.12 });
}

// ---------------------------------------------------------------------------
// Esquinas (marco local diagonal: se leen desde la esquina exterior)
// ---------------------------------------------------------------------------

// Flecha que apunta hacia +x, centrada en el origen
function arrowPath(ctx, len, shaft, headLen, headW) {
    const x0 = -len / 2, x1 = len / 2, xh = x1 - headLen;
    ctx.beginPath();
    ctx.moveTo(x0, -shaft / 2);
    ctx.lineTo(xh, -shaft / 2);
    ctx.lineTo(xh, -headW / 2);
    ctx.lineTo(x1, 0);
    ctx.lineTo(xh, headW / 2);
    ctx.lineTo(xh, shaft / 2);
    ctx.lineTo(x0, shaft / 2);
    ctx.lineTo(x0 + shaft * 0.45, 0);   // cola en "V"
    ctx.closePath();
}

function drawGo(R, r) {
    const { ctx } = R;
    inCell(ctx, r, () => {
        const small = { font: FONT_HEAVY, weight: '900', maxSize: 0.105, color: '#1d1d1d' };
        fittedLine(R, `COBRA $${GO_SALARY}`, 0, -0.68, 0.78, small);
        fittedLine(R, 'AL PASAR', 0, -0.545, 0.95, small);
        fittedLine(R, 'SALIDA', 0, -0.22, 1.36, {
            font: FONT_HEAVY, weight: '900', maxSize: 0.38, minSize: 0.2, spacing: 0.01,
            color: RED, stroke: DARK_RED, strokeWidth: 0.028,
            shadow: { color: 'rgba(0, 0, 0, 0.25)', blur: 0.02, y: 0.012 },
        });
    });

    // Flecha roja sobre el borde exterior, apuntando en el sentido del recorrido (hacia la casilla 1)
    const next = cellRect(1);
    const ang = Math.atan2(next.cz - r.cz, next.cx - r.cx);
    const off = r.w / 2 - 0.27;
    ctx.save();
    ctx.translate(r.cx + next.outward.x * off, r.cz + next.outward.z * off);
    ctx.rotate(ang);
    arrowPath(ctx, 1.26, 0.17, 0.42, 0.44);
    ctx.fillStyle = linearGradient(ctx, 0, -0.22, 0, 0.22, [[0, '#ff4b3e'], [0.5, RED], [1, '#a8120c']]);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = DARK_RED;
    ctx.stroke();
    ctx.restore();
}

function drawJail(R, r) {
    const { ctx } = R;
    const b = JAIL_BOX;
    const bw = b.x1 - b.x0, bh = b.z1 - b.z0;

    // Celda naranja con ventana enrejada (la parte "EN LA CÁRCEL")
    ctx.fillStyle = linearGradient(ctx, b.x0, b.z0, b.x1, b.z1, [[0, '#f9a23a'], [1, '#ee8410']]);
    ctx.fillRect(b.x0, b.z0, bw, bh);
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = INK;
    ctx.strokeRect(b.x0, b.z0, bw, bh);

    ctx.save();
    ctx.translate((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    ctx.rotate(r.canvasAngle);
    const w = 0.44;
    ctx.fillStyle = '#fdf3e0';
    ctx.fillRect(-w / 2, -w / 2, w, w);
    ctx.lineCap = 'butt';
    for (let i = 1; i <= 4; i++) {
        const x = -w / 2 + (i * w) / 5;
        strokeLine(ctx, x, -w / 2, x, w / 2, 0.026, INK);
    }
    strokeLine(ctx, -w / 2, 0, w / 2, 0, 0.012, INK);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = INK;
    ctx.strokeRect(-w / 2, -w / 2, w, w);
    const label = { font: FONT_HEAVY, weight: '900', maxSize: 0.13, color: INK };
    fittedLine(R, 'EN LA', 0, -0.37, 0.62, label);
    fittedLine(R, 'CÁRCEL', 0, 0.375, 0.62, label);
    ctx.restore();

    // "SOLO DE" en el brazo izquierdo de la L y "VISITA" en el inferior: cada uno se lee desde su lado
    const visit = { font: FONT_HEAVY, weight: '900', maxSize: 0.2, color: INK, spacing: 0.01 };
    ctx.save();
    ctx.translate((r.x0 + b.x0) / 2, (r.z0 + b.z1) / 2);
    ctx.rotate(cellRect(11).canvasAngle);
    fittedLine(R, 'SOLO DE', 0, 0, (b.z1 - r.z0) - 0.14, visit);
    ctx.restore();
    ctx.save();
    ctx.translate((b.x0 + r.x1) / 2, (b.z1 + r.z1) / 2);
    ctx.rotate(cellRect(9).canvasAngle);
    fittedLine(R, 'VISITA', 0, 0, (r.x1 - b.x0) - 0.14, visit);
    ctx.restore();
}

// Auto rojo clásico del Parking (mira hacia +x; largo 1 en unidades del auto)
function drawCar(R, cx, cy, len) {
    const { ctx } = R;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(len, len);
    ctx.lineJoin = 'round';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 0.22, 0.47, 0.045, 0, 0, Math.PI * 2);
    ctx.fill();

    // Carrocería
    ctx.beginPath();
    ctx.moveTo(-0.48, 0.13);
    ctx.lineTo(-0.49, 0.0);
    ctx.quadraticCurveTo(-0.48, -0.08, -0.36, -0.09);
    ctx.lineTo(-0.23, -0.1);
    ctx.lineTo(-0.13, -0.27);
    ctx.quadraticCurveTo(0.0, -0.3, 0.13, -0.27);
    ctx.lineTo(0.25, -0.1);
    ctx.lineTo(0.41, -0.085);
    ctx.quadraticCurveTo(0.5, -0.07, 0.5, 0.03);
    ctx.lineTo(0.5, 0.13);
    ctx.closePath();
    ctx.fillStyle = linearGradient(ctx, 0, -0.3, 0, 0.14, [[0, '#ff5b4d'], [0.55, '#e2231a'], [1, '#9e0f09']]);
    ctx.fill();
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = '#3a0603';
    ctx.stroke();

    // Ventanas
    ctx.fillStyle = '#c4e6f6';
    ctx.lineWidth = 0.016;
    ctx.beginPath();
    ctx.moveTo(-0.2, -0.11);
    ctx.lineTo(-0.115, -0.235);
    ctx.lineTo(-0.01, -0.245);
    ctx.lineTo(-0.01, -0.11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.03, -0.11);
    ctx.lineTo(0.03, -0.245);
    ctx.lineTo(0.115, -0.235);
    ctx.lineTo(0.215, -0.11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Puerta, parachoques y faro
    strokeLine(ctx, 0.01, -0.1, 0.01, 0.1, 0.012, '#3a0603');
    strokeLine(ctx, -0.5, 0.12, -0.38, 0.12, 0.03, '#2a2a2a');
    strokeLine(ctx, 0.4, 0.12, 0.51, 0.12, 0.03, '#2a2a2a');
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(0.465, -0.02, 0.028, 0, Math.PI * 2);
    ctx.fill();

    // Ruedas
    for (const wx of [-0.27, 0.29]) {
        ctx.fillStyle = '#1b1b1b';
        ctx.beginPath();
        ctx.arc(wx, 0.13, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#cfcfcf';
        ctx.beginPath();
        ctx.arc(wx, 0.13, 0.042, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawParking(R, r) {
    inCell(R.ctx, r, () => {
        const title = {
            font: FONT_HEAVY, weight: '900', maxSize: 0.21, color: RED, spacing: 0.01,
            stroke: 'rgba(74, 9, 5, 0.5)', strokeWidth: 0.012,
        };
        fittedLine(R, 'PARKING', 0, -0.56, 0.92, title);
        drawCar(R, 0, 0.0, 0.9);
        fittedLine(R, 'GRATIS', 0, 0.56, 0.92, title);
    });
}

function drawGoToJail(R, r) {
    inCell(R.ctx, r, () => {
        const title = { font: FONT_HEAVY, weight: '900', maxSize: 0.2, spacing: 0.008 };
        fittedLine(R, 'VAYA A LA', 0, -0.56, 0.92, { ...title, color: INK });
        drawEmoji(R, POLICE_ICON, 0, 0.02, ICON_SIZE.police);
        fittedLine(R, 'CÁRCEL', 0, 0.56, 0.92, { ...title, color: RED, stroke: 'rgba(74, 9, 5, 0.5)', strokeWidth: 0.012 });
    });
}

// ---------------------------------------------------------------------------
// Contenido de cada casilla
// ---------------------------------------------------------------------------
function drawCellContent(R, pos) {
    const cell = R.board[pos];
    const r = cellRect(pos);
    if (r.corner) {
        const type = cell?.type || CORNER_TYPES[pos];
        if (type === 'go') drawGo(R, r);
        else if (type === 'jail') drawJail(R, r);
        else if (type === 'parking') drawParking(R, r);
        else if (type === 'goToJail') drawGoToJail(R, r);
        return;
    }
    if (!cell) return;
    inCell(R.ctx, r, (hw, hh) => {
        switch (cell.type) {
            case 'property': drawStreet(R, cell, hw, hh); break;
            case 'railroad': drawRailroad(R, cell, hw, hh); break;
            case 'utility': drawUtility(R, cell, hw, hh); break;
            case 'chance': drawChance(R, hw, hh); break;
            case 'chest': drawChest(R, hw, hh); break;
            case 'tax': drawTax(R, cell, hw, hh); break;
            default: break;
        }
    });
}

// Dueño (franja de su color en el borde exterior + banderita) e hipoteca (velo gris + sello rojo)
function drawOwnership(R, pos) {
    const cell = R.board[pos];
    if (!cell || !OWNABLE.has(cell.type) || (!cell.owner && !cell.mortgaged)) return;
    const { ctx } = R;
    inCell(ctx, cellRect(pos), (hw, hh) => {
        if (cell.mortgaged) {
            ctx.fillStyle = 'rgba(64, 64, 64, 0.24)';
            ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        }
        if (cell.owner) {
            const color = R.players[cell.owner]?.color || OWNER_FALLBACK;
            const strip = 0.08;
            ctx.fillStyle = OWNER_FALLBACK;
            ctx.fillStyle = color;   // si el color no es válido, queda el gris de respaldo
            ctx.fillRect(-hw, hh - strip, hw * 2, strip);
            strokeLine(ctx, -hw, hh - strip, hw, hh - strip, 0.008, 'rgba(0, 0, 0, 0.5)');

            // Banderita del dueño junto al precio
            const px = hw - 0.13, base = hh - strip, top = base - 0.3;
            ctx.lineCap = 'round';
            strokeLine(ctx, px, base, px, top, 0.014, '#2b2b2b');
            ctx.beginPath();
            ctx.moveTo(px, top);
            ctx.lineTo(px - 0.15, top + 0.055);
            ctx.lineTo(px, top + 0.11);
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 0.008;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.stroke();
            ctx.fillStyle = '#2b2b2b';
            ctx.beginPath();
            ctx.arc(px, top, 0.014, 0, Math.PI * 2);
            ctx.fill();
        }
        if (cell.mortgaged) {
            // Sello "HIPOTECADA" en la diagonal de la casilla
            ctx.save();
            ctx.rotate(-Math.atan2(hh * 2, hw * 2));
            const stamp = { font: FONT_HEAVY, weight: '900', maxSize: 0.2, minSize: 0.08, spacing: 0.01 };
            const fit = fitText(ctx, 'HIPOTECADA', 1.3, 0.3, stamp);
            const w = 1.42, h = fit.size * 1.45;
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = 'rgba(255, 245, 240, 0.55)';
            roundRectPath(ctx, -w / 2, -h / 2, w, h, 0.03);
            ctx.fill();
            ctx.lineWidth = 0.02;
            ctx.strokeStyle = '#c8102e';
            ctx.stroke();
            roundRectPath(ctx, -w / 2 + 0.03, -h / 2 + 0.03, w - 0.06, h - 0.06, 0.02);
            ctx.lineWidth = 0.007;
            ctx.stroke();
            drawText(R, 'HIPOTECADA', 0, 0.005, { ...stamp, size: fit.size, color: '#c8102e', maxWidth: 1.3 });
            ctx.restore();
        }
    });
}

// ---------------------------------------------------------------------------
// Centro del tablero
// ---------------------------------------------------------------------------

// Ubicación del cartel "MONOPOLIO" sobre la diagonal, corrido para no invadir la zona de los dados
function bannerGeometry() {
    const half = 0.5;                                        // medio grosor del cartel
    const diag = (CENTER_RECT.x1 - CENTER_RECT.x0) * SQ;     // media diagonal del centro
    const maxLen = 5.1;
    let t0 = -maxLen / 2, t1 = maxLen / 2;
    const d = toTP(DICE_AREA.cx, DICE_AREA.cz);
    if (Math.abs(d.p) < half + DICE_AREA.r + 0.1) {
        if (d.t >= 0) {
            t1 = Math.min(t1, d.t - DICE_AREA.r - 0.18);
            t0 = Math.max(-diag + 1.9, t1 - maxLen);
        } else {
            t0 = Math.max(t0, d.t + DICE_AREA.r + 0.18);
            t1 = Math.min(diag - 1.9, t0 + maxLen);
        }
    }
    return { tc: (t0 + t1) / 2, len: t1 - t0, half };
}

function drawBanner(R) {
    const { ctx } = R;
    const g = bannerGeometry();
    const c = fromTP(g.tc, 0);
    const L = g.len, T = g.half * 2;
    ctx.save();
    ctx.translate(c.x, c.z);
    ctx.rotate(-Math.PI / 4);   // de abajo-izquierda a arriba-derecha, legible desde abajo

    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(-L / 2 + 0.05, -T / 2 + 0.07, L, T);
    ctx.fillStyle = '#141414';
    ctx.fillRect(-L / 2 - 0.04, -T / 2 - 0.04, L + 0.08, T + 0.08);
    ctx.fillStyle = linearGradient(ctx, 0, -T / 2, 0, T / 2, [[0, '#f5383c'], [0.5, '#e01b22'], [1, '#b3111a']]);
    ctx.fillRect(-L / 2, -T / 2, L, T);
    strokeInset(ctx, -L / 2, -T / 2, L, T, 0.08, 0.05, '#ffffff');

    fittedLine(R, 'MONOPOLIO', 0, 0.02, L - 0.5, {
        font: FONT_HEAVY, weight: '900', maxSize: 0.74, minSize: 0.3, spacing: 0.03,
        color: '#ffffff', stroke: '#141414', strokeWidth: 0.05,
        shadow: { color: 'rgba(0, 0, 0, 0.35)', blur: 0.03, x: 0.01, y: 0.02 },
    });

    // Subtítulo con filetes decorativos
    const subY = T / 2 + 0.34;
    const subSize = fittedLine(R, 'Juegos', 0, subY, L - 1.4, {
        font: FONT_SERIF, weight: 'bold', style: 'italic', maxSize: 0.27, color: '#7b1a1f',
    });
    const subW = Math.min(L - 1.4, fitWidth(ctx, 'Juegos', subSize, FONT_SERIF, 'bold', 'italic'));
    const gap = 0.14, lineLen = 0.45;
    ctx.fillStyle = '#7b1a1f';
    for (const sgn of [-1, 1]) {
        const x0 = sgn * (subW / 2 + gap);
        strokeLine(ctx, x0, subY, x0 + sgn * lineLen, subY, 0.012, 'rgba(123, 26, 31, 0.7)');
        ctx.beginPath();
        const dx = x0 + sgn * (lineLen + 0.06);
        ctx.moveTo(dx - 0.05, subY);
        ctx.lineTo(dx, subY - 0.05);
        ctx.lineTo(dx + 0.05, subY);
        ctx.lineTo(dx, subY + 0.05);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function fitWidth(ctx, str, size, font, weight, style) {
    ctx.save();
    setFont(ctx, size, font, weight, style, 0);
    const w = ctx.measureText(str).width / TXT;
    ctx.restore();
    return w;
}

// Lugar impreso para un mazo de cartas: contorno punteado, ícono tenue y etiqueta por fuera
function drawCardSlot(R, slot, label, color, tint, kind) {
    const { ctx } = R;
    ctx.save();
    ctx.translate(slot.cx, slot.cz);
    ctx.rotate(-slot.rot);   // giro en Y del mundo -> giro del lienzo (el eje y del lienzo es +z)
    const w = slot.w, h = slot.h;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, 0.12);
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.setLineDash([0.15, 0.09]);
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
    roundRectPath(ctx, -w / 2 + 0.07, -h / 2 + 0.07, w - 0.14, h - 0.14, 0.08);
    ctx.lineWidth = 0.008;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (kind === 'chance') {
        drawText(R, '?', 0, 0.02, { size: 0.9, font: FONT_HEAVY, weight: '900', color, alpha: 0.22 });
    } else {
        drawEmoji(R, CHEST_ICON, 0, 0.02, ICON_SIZE.slot, { alpha: 0.28, shadow: false });
    }

    // La etiqueta va del lado del mazo que da hacia afuera del centro
    const away = Math.sign(slot.cx * Math.sin(slot.rot) + slot.cz * Math.cos(slot.rot)) || 1;
    fittedLine(R, label, 0, away * (h / 2 + 0.24), w + 0.2, {
        font: FONT_HEAVY, weight: '900', maxSize: 0.27, spacing: 0.015, color,
        stroke: 'rgba(255, 255, 255, 0.55)', strokeWidth: 0.03,
    });
    ctx.restore();
}

// Rosa de los vientos impresa, muy tenue (el norte apunta a la fila de arriba, -z)
function drawCompass(R, cx, cz, rad) {
    const { ctx } = R;
    const ink = 'rgba(22, 84, 50, 0.30)';
    const inkSoft = 'rgba(22, 84, 50, 0.13)';
    ctx.save();
    ctx.translate(cx, cz);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    ctx.arc(0, 0, rad * 0.84, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
        const a = (i * Math.PI) / 18;
        const r0 = i % 9 === 0 ? rad * 0.7 : rad * 0.84;
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.lineWidth = 0.005;
    ctx.stroke();

    // Puntas: primero las cortas (diagonales) y encima las largas; cada punta con una mitad oscura
    for (const long of [false, true]) {
        for (let i = long ? 0 : 1; i < 8; i += 2) {
            const a = -Math.PI / 2 + (i * Math.PI) / 4;
            const len = long ? rad * 0.8 : rad * 0.5;
            const wid = long ? rad * 0.13 : rad * 0.08;
            const tx = Math.cos(a) * len, tz = Math.sin(a) * len;
            const sx = Math.cos(a - Math.PI / 2) * wid, sz = Math.sin(a - Math.PI / 2) * wid;
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(tx, tz); ctx.lineTo(sx, sz); ctx.closePath();
            ctx.fillStyle = ink;
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(tx, tz); ctx.lineTo(-sx, -sz); ctx.closePath();
            ctx.fillStyle = inkSoft;
            ctx.fill();
        }
    }
    for (const [letter, dx, dz] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['O', -1, 0]]) {
        drawText(R, letter, dx * (rad + 0.13), dz * (rad + 0.13), { size: 0.15, font: FONT_SERIF, weight: 'bold', color: ink });
    }
    ctx.restore();
}

// Panel central apenas más claro dentro del filete (relleno plano: un degradado de este tamaño es caro)
function drawCenterBase(R) {
    const { ctx } = R;
    const c = CENTER_RECT;
    const inset = 0.24;
    ctx.fillStyle = '#d6ebd9';
    ctx.fillRect(c.x0 + inset, c.z0 + inset, c.x1 - c.x0 - inset * 2, c.z1 - c.z0 - inset * 2);
}

function drawCenterArt(R) {
    const { ctx } = R;
    const c = CENTER_RECT;
    const w = c.x1 - c.x0, h = c.z1 - c.z0;

    // Doble filete impreso alrededor del centro, con rombos en las esquinas
    strokeInset(ctx, c.x0, c.z0, w, h, 0.16, 0.014, 'rgba(28, 92, 52, 0.35)');
    strokeInset(ctx, c.x0, c.z0, w, h, 0.24, 0.006, 'rgba(28, 92, 52, 0.3)');
    ctx.fillStyle = 'rgba(28, 92, 52, 0.35)';
    for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z0], [c.x0, c.z1], [c.x1, c.z1]]) {
        const px = x + Math.sign(-x) * 0.2, pz = z + Math.sign(-z) * 0.2;
        ctx.beginPath();
        ctx.moveTo(px - 0.08, pz);
        ctx.lineTo(px, pz - 0.08);
        ctx.lineTo(px + 0.08, pz);
        ctx.lineTo(px, pz + 0.08);
        ctx.closePath();
        ctx.fill();
    }

    // Rosa de los vientos en el extremo libre de la diagonal (más allá de la zona de los dados)
    const diag = w * SQ;
    const d = toTP(DICE_AREA.cx, DICE_AREA.cz);
    const sgn = d.t >= 0 ? 1 : -1;
    const far = Math.abs(d.t) + DICE_AREA.r;
    const rose = fromTP(sgn * (far + diag - 1.0) / 2, 0);
    drawCompass(R, rose.x, rose.z, 0.62);

    drawCardSlot(R, CHEST_SLOT, 'ARCA COMUNAL', BLUE, 'rgba(0, 114, 187, 0.08)', 'chest');
    drawCardSlot(R, CHANCE_SLOT, 'SUERTE', ORANGE, 'rgba(247, 148, 29, 0.10)', 'chance');
    drawBanner(R);
}

// ---------------------------------------------------------------------------
// Líneas de la grilla y marco exterior
// ---------------------------------------------------------------------------
function drawGrid(R) {
    const { ctx } = R;
    ctx.lineWidth = 0.016;
    ctx.strokeStyle = INK;
    for (let pos = 0; pos < 40; pos++) {
        const r = cellRect(pos);
        ctx.strokeRect(r.x0, r.z0, r.w, r.d);
    }
    const c = CENTER_RECT;
    ctx.lineWidth = 0.02;
    ctx.strokeRect(c.x0, c.z0, c.x1 - c.x0, c.z1 - c.z0);
    const frame = 0.034;
    ctx.lineWidth = frame;
    ctx.strokeRect(-HALF + frame / 2, -HALF + frame / 2, BOARD_SIZE - frame, BOARD_SIZE - frame);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

// Dibuja la cara superior completa del tablero en un contexto 2D de size x size píxeles.
export function drawBoard(ctx, size, state) {
    const s = size / BOARD_SIZE;   // píxeles por unidad del mundo
    const R = {
        ctx, s, size,
        board: Array.isArray(state?.board) ? state.board : [],
        players: state?.players || {},
    };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = MINT;
    ctx.fillRect(0, 0, size, size);

    // Desde aquí se dibuja en unidades del mundo: (x, z) -> píxel ((x + HALF) * s, (z + HALF) * s)
    ctx.setTransform(s, 0, 0, s, HALF * s, HALF * s);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    drawCenterBase(R);
    for (let pos = 0; pos < 40; pos++) drawCellBackground(R, pos);
    drawGrain(R);
    drawCenterArt(R);
    for (let pos = 0; pos < 40; pos++) drawCellContent(R, pos);
    for (let pos = 0; pos < 40; pos++) drawOwnership(R, pos);
    drawGrid(R);

    ctx.restore();
}

// Opcional: prepara en tiempo ocioso los sprites de emojis y el grano del papel para que el primer
// drawBoard(ctx, size, …) no se trabe (rasterizar un emoji a color en frío cuesta varios ms).
// Devuelve una promesa que se cumple al terminar. Llamarla varias veces no repite trabajo.
export function warmBoardTexture(size = 2048) {
    const s = size / BOARD_SIZE;
    const px = (units) => Math.max(8, Math.round(units * s));
    const jobs = [
        () => grainDots(),
        ...Object.values(PROPERTY_ICONS).map(ch => () => emojiSprite(ch, px(ICON_SIZE.street), true)),
        () => emojiSprite(RAILROAD_ICON, px(ICON_SIZE.railroad), true),
        ...Object.values(UTILITY_ICONS).map(ch => () => emojiSprite(ch, px(ICON_SIZE.utility), true)),
        () => emojiSprite(CHEST_ICON, px(ICON_SIZE.chest), true),
        () => emojiSprite(TAX_ICONS.income, px(ICON_SIZE.tax), true),
        () => emojiSprite(TAX_ICONS.luxury, px(ICON_SIZE.tax), true),
        () => emojiSprite(POLICE_ICON, px(ICON_SIZE.police), true),
        () => emojiSprite(CHEST_ICON, px(ICON_SIZE.slot), false),
    ];
    const later = typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(fn, { timeout: 400 })
        : (fn) => setTimeout(() => fn(null), 16);
    return new Promise((resolve) => {
        const step = (deadline) => {
            // Al menos un trabajo por turno; más si el navegador todavía tiene tiempo libre
            do {
                const job = jobs.shift();
                if (!job) { resolve(); return; }
                job();
            } while (deadline && deadline.timeRemaining() > 10);
            later(step);
        };
        later(step);
    });
}

// Cadena que cambia solo cuando cambiaría el dibujo: dueño (por su color) e hipoteca de cada casilla comprable.
export function boardSignature(state) {
    const board = state?.board;
    if (!Array.isArray(board)) return 'sin-tablero';
    const players = state.players || {};
    let sig = '';
    for (const cell of board) {
        if (!cell || !OWNABLE.has(cell.type)) continue;
        const color = cell.owner ? (players[cell.owner]?.color || OWNER_FALLBACK) : '-';
        sig += `${cell.id}:${color}${cell.mortgaged ? ':H' : ''};`;
    }
    return sig;
}
