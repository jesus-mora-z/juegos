// Geometría compartida del tablero 3D del Monopoly.
// Unidades: 1 = ancho de una casilla normal. El tablero está centrado en el origen, sobre el plano XZ,
// con la cara superior en y = 0. El jugador "mira" desde +z (la fila de la Salida queda más cerca).
//
// Recorrido (igual que el tablero HTML): la casilla 0 (Salida) es la esquina (+x, +z);
// fila de abajo de derecha a izquierda (0..10), columna izquierda de abajo hacia arriba (10..20),
// fila de arriba de izquierda a derecha (20..30) y columna derecha de arriba hacia abajo (30..39).
//
// Textura del tablero: el píxel (px, py) de un lienzo de W x H corresponde al punto del mundo
//   x = px / W * BOARD_SIZE - HALF,   z = py / H * BOARD_SIZE - HALF
// (ver worldToCanvas / canvasToWorld). La escena debe mapear la textura para que esto se cumpla.

export const CELL = 1;
export const CORNER = 1.6;
export const BOARD_SIZE = CORNER * 2 + CELL * 9;   // 12.2
export const HALF = BOARD_SIZE / 2;                // 6.1
export const BAND = 0.34;                          // profundidad de la banda de color (lado interior)
export const BOARD_THICKNESS = 0.22;               // grosor de la losa del tablero

// Rectángulo del centro (entre las casillas)
export const CENTER_RECT = { x0: -HALF + CORNER, x1: HALF - CORNER, z0: -HALF + CORNER, z1: HALF - CORNER };

// Lugares impresos en el centro para los mazos (rot = giro en Y, en radianes)
export const CHEST_SLOT = { cx: -2.35, cz: -2.35, w: 2.1, h: 1.35, rot: Math.PI / 4 };
export const CHANCE_SLOT = { cx: 2.35, cz: 2.35, w: 2.1, h: 1.35, rot: Math.PI / 4 };
// Zona donde caen los dados (círculo)
export const DICE_AREA = { cx: 1.6, cz: -1.2, r: 1.1 };

export function sideOf(pos) {
    if (pos % 10 === 0) return 'corner';
    return pos < 10 ? 'bottom' : pos < 20 ? 'left' : pos < 30 ? 'top' : 'right';
}

// Rectángulo de una casilla en coordenadas del mundo.
// Devuelve { x0, x1, z0, z1, cx, cz, w, d, side, corner, band, outward, canvasAngle, yaw }
//  - band: rectángulo de la banda de color (solo calles) sobre el borde interior.
//  - outward: vector unitario (x, z) que apunta hacia afuera del tablero.
//  - canvasAngle: rotación (radianes, sentido del lienzo) para que el texto se lea desde afuera.
//  - yaw: rotación en Y para que un objeto 3D "mire" hacia el jugador sentado en ese lado.
export function cellRect(pos) {
    const k = pos % 10;
    const group = Math.floor(pos / 10);   // 0 abajo, 1 izquierda, 2 arriba, 3 derecha
    let x0, x1, z0, z1;
    if (k === 0) {
        if (group === 0) { x0 = HALF - CORNER; x1 = HALF; z0 = HALF - CORNER; z1 = HALF; }
        else if (group === 1) { x0 = -HALF; x1 = -HALF + CORNER; z0 = HALF - CORNER; z1 = HALF; }
        else if (group === 2) { x0 = -HALF; x1 = -HALF + CORNER; z0 = -HALF; z1 = -HALF + CORNER; }
        else { x0 = HALF - CORNER; x1 = HALF; z0 = -HALF; z1 = -HALF + CORNER; }
    } else if (group === 0) {
        x1 = HALF - CORNER - (k - 1) * CELL; x0 = x1 - CELL; z0 = HALF - CORNER; z1 = HALF;
    } else if (group === 1) {
        z1 = HALF - CORNER - (k - 1) * CELL; z0 = z1 - CELL; x0 = -HALF; x1 = -HALF + CORNER;
    } else if (group === 2) {
        x0 = -HALF + CORNER + (k - 1) * CELL; x1 = x0 + CELL; z0 = -HALF; z1 = -HALF + CORNER;
    } else {
        z0 = -HALF + CORNER + (k - 1) * CELL; z1 = z0 + CELL; x0 = HALF - CORNER; x1 = HALF;
    }
    const side = sideOf(pos);
    const OUT = { bottom: [0, 1], left: [-1, 0], top: [0, -1], right: [1, 0] };
    const ANGLE = { bottom: 0, left: Math.PI / 2, top: Math.PI, right: -Math.PI / 2 };
    const YAW = { bottom: 0, left: -Math.PI / 2, top: Math.PI, right: Math.PI / 2 };
    // Esquinas: el texto va en diagonal, mirando hacia el centro
    const CORNER_ANGLE = [-Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4];
    const CORNER_OUT = [[0.7071, 0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
    const CORNER_YAW = [Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4];

    let band = null;
    if (side === 'bottom') band = { x0, x1, z0, z1: z0 + BAND };
    else if (side === 'left') band = { x0: x1 - BAND, x1, z0, z1 };
    else if (side === 'top') band = { x0, x1, z0: z1 - BAND, z1 };
    else if (side === 'right') band = { x0, x1: x0 + BAND, z0, z1 };

    const isCorner = side === 'corner';
    const [ox, oz] = isCorner ? CORNER_OUT[group] : OUT[side];
    return {
        x0, x1, z0, z1,
        cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
        w: x1 - x0, d: z1 - z0,
        side, corner: isCorner, band,
        outward: { x: ox, z: oz },
        canvasAngle: isCorner ? CORNER_ANGLE[group] : ANGLE[side],
        yaw: isCorner ? CORNER_YAW[group] : YAW[side],
    };
}

// Celda de la cárcel (esquina 10): la parte interior con rejas es "EN LA CÁRCEL"; el resto, "de visita".
export const JAIL_BOX = (() => {
    const r = cellRect(10);   // x0 = -HALF, z1 = HALF
    return { x0: r.x0 + 0.5, x1: r.x1, z0: r.z0, z1: r.z1 - 0.5 };
})();

// Puntos (x, z) para ubicar n fichas dentro de una casilla, sin tapar la banda de color.
// jailed = true: dentro de las rejas de la cárcel.
export function tokenSlots(pos, n, { jailed = false } = {}) {
    const r = cellRect(pos);
    let area;
    if (pos === 10) {
        area = jailed ? JAIL_BOX
            : { x0: r.x0 + 0.05, x1: r.x0 + 0.5, z0: r.z0 + 0.1, z1: r.z1 - 0.05, strip: true };
    } else if (r.band) {
        const b = r.band;
        if (r.side === 'bottom') area = { x0: r.x0, x1: r.x1, z0: b.z1, z1: r.z1 };
        else if (r.side === 'left') area = { x0: r.x0, x1: b.x0, z0: r.z0, z1: r.z1 };
        else if (r.side === 'top') area = { x0: r.x0, x1: r.x1, z0: r.z0, z1: b.z0 };
        else area = { x0: b.x1, x1: r.x1, z0: r.z0, z1: r.z1 };
    } else {
        area = r;
    }
    const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
    if (n <= 1) return [{ x: cx, z: cz }];
    const w = area.x1 - area.x0, d = area.z1 - area.z0;
    const cols = Math.ceil(Math.sqrt(n * (w / d)));
    const rows = Math.ceil(n / cols);
    const pts = [];
    for (let i = 0; i < n; i++) {
        const c = i % cols, row = Math.floor(i / cols);
        pts.push({
            x: area.x0 + w * (c + 0.5) / cols,
            z: area.z0 + d * (row + 0.5) / rows,
        });
    }
    return pts;
}

// Casilla que contiene el punto (x, z) del mundo, o -1 si cae en el centro o fuera del tablero.
export function posAt(x, z) {
    for (let p = 0; p < 40; p++) {
        const r = cellRect(p);
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return p;
    }
    return -1;
}

export function worldToCanvas(x, z, W, H) {
    return { px: (x + HALF) / BOARD_SIZE * W, py: (z + HALF) / BOARD_SIZE * H };
}

export function canvasToWorld(px, py, W, H) {
    return { x: px / W * BOARD_SIZE - HALF, z: py / H * BOARD_SIZE - HALF };
}
