// Fichas 3D del Monopoly: réplicas de las clásicas fichas de peltre pulido sobre una base con el color del jugador.
// Todo se construye con primitivas de Three.js (torno, extrusiones con bisel, esferas, toros...), sin archivos externos.
//
// Convención: origen en el centro de la base, apoyadas en y = 0 y mirando hacia +z; alto máximo ~0.7 y todo cabe en un
// radio de 0.3. Las geometrías se comparten entre fichas (caché por tipo) y solo los materiales que dependen del color
// del jugador son propios. Los reflejos del metal dependen de scene.environment (lo define la escena).
//
// API de cada ficha (en group.userData):
//   setHighlight({ mine, active })  mine: anillo dorado sutil en la base; active: anillo brillante que late.
//   tick(t)                          t en segundos; hace latir el anillo activo (y gira la hélice del avión).
//   setColor(color)                  cambia el color del jugador sin reconstruir la ficha.
//   dispose()                        libera solo los materiales propios de la ficha (las geometrías son compartidas).
//   kind, height                     tipo de ficha y alto real del modelo.

import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TOKEN_KINDS = ['car', 'plane', 'dog', 'hat', 'ship', 'boot', 'cat', 'rocket'];

// ---- Medidas de la base ----
const BASE_R = 0.262;          // radio de la base de color
const Y0 = 0.046;              // cara superior de la placa de peltre: ahí se apoya cada figura
const CREASE = 0.9;            // ángulo (rad) sobre el cual una arista se ve "viva" en vez de suavizada

// Perfil (radio, alto) de la base de color y de la placa de peltre que va encima
const BASE_PROFILE = [[0, 0], [0.248, 0], [0.258, 0.005], [BASE_R, 0.016], [0.259, 0.028], [0.25, 0.035], [0.23, 0.036], [0, 0.036]];
const PLATE_PROFILE = [[0, 0.03], [0.198, 0.03], [0.206, 0.034], [0.208, 0.04], [0.203, 0.045], [0.194, Y0], [0, Y0]];

// ---------------------------------------------------------------------------
// Utilidades de geometría
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

const smooth = (t) => {
    const k = Math.min(1, Math.max(0, t));
    return k * k * (3 - 2 * k);
};

// Matriz a partir de { p: posición, r: rotación Euler XYZ, s: escala (número o [x, y, z]) }
function matrixOf({ p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}, target = new THREE.Matrix4()) {
    const sc = typeof s === 'number' ? [s, s, s] : s;
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    return target.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(sc[0], sc[1], sc[2]));
}

// Deforma cada vértice con fn(v) (las normales se recalculan al fusionar)
function bend(geo, fn) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        fn(_v);
        pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    return geo;
}

// Normales "con pliegue": suaviza curvas y biseles pero deja vivas las aristas marcadas.
// toCreasedNormals agrupa vértices con una precisión de 0.01 unidades, demasiado gruesa para piezas tan chicas:
// se escala x100 mientras se calculan.
function creased(geo) {
    geo.scale(100, 100, 100);
    const out = toCreasedNormals(geo, CREASE);
    if (out !== geo) geo.dispose();
    out.scale(0.01, 0.01, 0.01);
    for (const name of Object.keys(out.attributes)) {
        if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
    }
    out.clearGroups();
    return out;
}

// Une una lista de geometrías (mismo material) en una sola, con normales listas.
// Queda sin índice a propósito: indexarla con mergeVertices triplicaba el tiempo de creación (~0.4 s en total)
// y con tan pocos vértices la memoria extra no se nota.
function fuse(list) {
    if (!list.length) return null;
    const prepared = list.map(creased);
    const out = mergeGeometries(prepared, false);
    prepared.forEach((g) => g.dispose());
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
}

const lathe = (profile, segments = 40) =>
    new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
const sphere = (r, ws = 18, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const torus = (R, t, rs = 8, ts = 32) => new THREE.TorusGeometry(R, t, rs, ts);
const box = (w, h, d, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, r);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

// Figura plana (plano XY) extruida a lo largo de z, centrada, con los bordes redondeados por un bisel.
// El bisel se aplica hacia adentro (bevelOffset negativo) para que la silueta final sea exactamente la dibujada.
function extrudeFlat(shape, thickness, bevel = 0.01, curveSegments = 14) {
    const b = Math.min(bevel, thickness * 0.45);
    const depth = Math.max(1e-4, thickness - 2 * b);
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth, curveSegments,
        bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3,
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
}

// Silueta de perfil (x del dibujo = z del mundo, y = alto) extruida a lo ancho (eje x), centrada en x = 0
const extrudeSide = (shape, width, bevel, seg) => extrudeFlat(shape, width, bevel, seg).rotateY(-Math.PI / 2);

// Contorno visto desde arriba (x del dibujo = x del mundo, y del dibujo = z del mundo) extruido hacia arriba desde y = 0
function extrudeTop(shape, height, bevel, seg) {
    const geo = extrudeFlat(shape, height, bevel, seg).rotateX(Math.PI / 2);
    geo.translate(0, height / 2, 0);
    return geo;
}

// Tubo que se afina hacia la punta (la cola del gato)
function taperedTube(points, r0, r1, tubular = 40, radial = 10) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const geo = new THREE.TubeGeometry(curve, tubular, r0, radial, false);
    const pos = geo.attributes.position;
    const c = new THREE.Vector3();
    for (let i = 0; i <= tubular; i++) {
        const t = i / tubular;
        curve.getPointAt(t, c);
        const k = (r0 + (r1 - r0) * t) / r0;
        for (let j = 0; j <= radial; j++) {
            const idx = i * (radial + 1) + j;
            _v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
            pos.setXYZ(idx, _v.x, _v.y, _v.z);
        }
    }
    return { geo, end: curve.getPointAt(1) };
}

// Acumula las piezas de una figura en dos grupos: peltre brillante (metal) y peltre oscuro (shade).
// within(t, fn) agrega un marco de referencia (p. ej. el avión inclinado) a todo lo que se agregue dentro de fn.
class Parts {
    constructor() {
        this.lists = { metal: [], shade: [] };
        this.frame = new THREE.Matrix4();
    }

    _push(list, geo, t) {
        if (t) geo.applyMatrix4(matrixOf(t, _m));
        geo.applyMatrix4(this.frame);
        this.lists[list].push(geo);
        return this;
    }

    metal(geo, t) { return this._push('metal', geo, t); }

    shade(geo, t) { return this._push('shade', geo, t); }

    within(t, fn) {
        const prev = this.frame.clone();
        this.frame.multiply(matrixOf(t));
        fn();
        this.frame.copy(prev);
    }

    build() {
        return { metal: fuse(this.lists.metal), shade: fuse(this.lists.shade) };
    }
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

// Auto: roadster antiguo (carrocería extruida, guardabarros, estribos, parabrisas, asiento, volante y 4 ruedas)
function buildCar(P) {
    const G = Y0;
    const WY = G + 0.075, FZ = 0.16, RZ = -0.155, TX = 0.112;   // centro de ruedas, ejes delantero/trasero, trocha

    const body = new THREE.Shape();
    body.moveTo(0.248, G + 0.085);
    body.lineTo(0.256, G + 0.165);
    body.quadraticCurveTo(0.258, G + 0.195, 0.232, G + 0.197);        // frente del radiador
    body.lineTo(0.06, G + 0.205);                                    // capó
    body.quadraticCurveTo(0.036, G + 0.207, 0.03, G + 0.19);
    body.lineTo(0.022, G + 0.172);
    body.lineTo(-0.095, G + 0.172);                                  // cabina abierta
    body.quadraticCurveTo(-0.108, G + 0.2, -0.14, G + 0.2);
    body.quadraticCurveTo(-0.245, G + 0.2, -0.258, G + 0.14);          // cola redondeada
    body.quadraticCurveTo(-0.264, G + 0.1, -0.24, G + 0.085);
    body.closePath();
    P.metal(extrudeSide(body, 0.17, 0.024));

    // Guardabarros (arcos sobre cada rueda) y estribos
    const fender = (zc, a0, a1) => {
        const f = new THREE.Shape();
        f.absarc(zc, WY, 0.097, a0, a1, false);
        f.absarc(zc, WY, 0.081, a1, a0, true);
        f.closePath();
        return f;
    };
    for (const sx of [-1, 1]) {
        P.metal(extrudeSide(fender(FZ, 0.3, Math.PI - 0.08), 0.05, 0.006), { p: [sx * TX, 0, 0] });
        P.metal(extrudeSide(fender(RZ, 0.08, Math.PI - 0.3), 0.05, 0.006), { p: [sx * TX, 0, 0] });
        P.metal(box(0.05, 0.01, 0.13, 0.004), { p: [sx * TX, G + 0.08, 0.003] });
    }

    // Ruedas: neumático, llanta y tapacubos
    for (const [x, z] of [[TX, FZ], [-TX, FZ], [TX, RZ], [-TX, RZ]]) {
        P.shade(torus(0.056, 0.019, 10, 28), { p: [x, WY, z], r: [0, Math.PI / 2, 0] });
        P.metal(cyl(0.05, 0.05, 0.026, 24), { p: [x, WY, z], r: [0, 0, Math.PI / 2] });
        P.metal(sphere(0.026, 16, 10), { p: [x + Math.sign(x) * 0.013, WY, z], s: [0.55, 1, 1] });
    }
    // Ejes y chasis
    for (const z of [FZ, RZ]) P.shade(cyl(0.008, 0.008, 2 * TX, 8), { p: [0, WY, z], r: [0, 0, Math.PI / 2] });
    P.shade(box(0.12, 0.022, 0.42, 0.006), { p: [0, G + 0.08, 0] });

    // Frente: parrilla, parachoques, focos y tapa del radiador
    P.shade(box(0.11, 0.07, 0.012, 0.004), { p: [0, G + 0.128, 0.256] });
    P.metal(cyl(0.009, 0.009, 0.2, 12), { p: [0, G + 0.07, 0.262], r: [0, 0, Math.PI / 2] });
    for (const sx of [-1, 1]) {
        P.metal(sphere(0.026, 16, 12), { p: [sx * 0.1, G + 0.168, 0.225], s: [1, 1, 0.85] });
        P.shade(sphere(0.019, 12, 8), { p: [sx * 0.1, G + 0.168, 0.244], s: [1, 1, 0.35] });
        P.metal(cyl(0.005, 0.005, 0.05, 8), { p: [sx * 0.096, G + 0.135, 0.222] });
    }
    P.metal(sphere(0.013, 12, 8), { p: [0, G + 0.21, 0.236] });

    // Parabrisas inclinado hacia atrás
    P.within({ p: [0, G + 0.195, 0.028], r: [-0.28, 0, 0] }, () => {
        P.shade(box(0.14, 0.075, 0.006, 0.002), { p: [0, 0.04, 0] });
        for (const sx of [-1, 1]) P.metal(cyl(0.0055, 0.0055, 0.085, 8), { p: [sx * 0.074, 0.042, 0] });
        P.metal(cyl(0.0055, 0.0055, 0.152, 8), { p: [0, 0.082, 0], r: [0, 0, Math.PI / 2] });
    });
    // Respaldo del asiento, volante y columna de dirección
    P.shade(box(0.15, 0.07, 0.035, 0.012), { p: [0, G + 0.195, -0.083], r: [-0.22, 0, 0] });
    P.shade(torus(0.027, 0.005, 8, 20), { p: [0.04, G + 0.215, -0.005], r: [0.7, 0, 0] });
    P.shade(cyl(0.004, 0.004, 0.06, 8), { p: [0.04, G + 0.196, 0.018], r: [-0.88, 0, 0] });
}

// Avión: monoplano clásico "en vuelo" sobre un pedestal, con la nariz levemente hacia arriba
function buildPlane(P) {
    const G = Y0;
    // Pedestal
    P.metal(lathe([[0, 0], [0.056, 0], [0.054, 0.008], [0.034, 0.016], [0.015, 0.032], [0.0095, 0.07],
        [0.0085, 0.25], [0.014, 0.262], [0.02, 0.282], [0, 0.29]], 28), { p: [0, G - 0.002, 0] });

    const pivot = { p: [0, 0.372, 0], r: [-0.14, 0, 0] };
    P.within(pivot, () => {
        // Fuselaje torneado sobre el eje z, con la cola levantada
        const fus = lathe([[0, -0.235], [0.012, -0.226], [0.022, -0.17], [0.036, -0.09], [0.05, 0], [0.056, 0.08],
            [0.058, 0.14], [0.055, 0.19], [0.047, 0.214], [0.03, 0.224], [0, 0.226]], 32).rotateX(Math.PI / 2);
        bend(fus, (v) => { v.y += 0.022 * smooth((-v.z - 0.04) / 0.18); });
        P.metal(fus);
        P.shade(torus(0.0565, 0.0065, 8, 32), { p: [0, 0, 0.188] });                       // anillo del motor
        P.shade(sphere(0.04, 20, 12), { p: [0, 0.042, 0.005], s: [0.78, 0.7, 1.5] });       // cabina

        // Alas con diedro
        const w = new THREE.Shape();
        w.moveTo(0, 0.088);
        w.lineTo(0.21, 0.068);
        w.quadraticCurveTo(0.25, 0.064, 0.248, 0.036);
        w.quadraticCurveTo(0.246, 0.008, 0.205, 0.005);
        w.lineTo(0, -0.035);
        w.lineTo(-0.205, 0.005);
        w.quadraticCurveTo(-0.246, 0.008, -0.248, 0.036);
        w.quadraticCurveTo(-0.25, 0.064, -0.21, 0.068);
        w.closePath();
        const wing = extrudeTop(w, 0.022, 0.008);
        bend(wing, (v) => { v.y += Math.abs(v.x) * 0.1; });
        P.metal(wing, { p: [0, -0.036, 0] });

        // Estabilizador horizontal y deriva
        const hs = new THREE.Shape();
        hs.moveTo(0, -0.155);
        hs.lineTo(0.08, -0.183);
        hs.quadraticCurveTo(0.1, -0.188, 0.098, -0.208);
        hs.lineTo(0.06, -0.226);
        hs.lineTo(-0.06, -0.226);
        hs.lineTo(-0.098, -0.208);
        hs.quadraticCurveTo(-0.1, -0.188, -0.08, -0.183);
        hs.closePath();
        P.metal(extrudeTop(hs, 0.012, 0.004), { p: [0, 0.008, 0] });
        const fin = new THREE.Shape();
        fin.moveTo(-0.15, 0.03);
        fin.quadraticCurveTo(-0.195, 0.1, -0.222, 0.118);
        fin.lineTo(-0.24, 0.114);
        fin.quadraticCurveTo(-0.248, 0.06, -0.236, 0.018);
        fin.closePath();
        P.metal(extrudeSide(fin, 0.014, 0.004));

        // Tren de aterrizaje con carenados
        for (const sx of [-1, 1]) {
            P.metal(cyl(0.0055, 0.0055, 0.06, 8), { p: [sx * 0.081, -0.058, 0.045], r: [0, 0, sx * 0.12] });
            P.shade(sphere(0.028, 16, 10), { p: [sx * 0.085, -0.105, 0.045], s: [0.6, 0.78, 1.45] });
        }
    });

    // Hélice: malla aparte para que pueda girar sobre su eje (z local)
    const H = new Parts();
    H.metal(lathe([[0, 0], [0.027, 0], [0.025, 0.014], [0.015, 0.032], [0, 0.04]], 20).rotateX(Math.PI / 2));
    for (const a of [0, Math.PI]) {
        H.within({ r: [0, 0, a] }, () => H.metal(box(0.022, 0.085, 0.007, 0.0034), { p: [0, 0.047, 0.008], r: [0, 0.35, 0] }));
    }
    return { spinner: { geo: H.build().metal, pivot, offset: [0, 0, 0.222] } };
}

// Perro: scottie terrier (cuerpo de perfil extruido, faldón de pelo, cabeza con barba, cejas, orejas y cola)
function buildDog(P) {
    const G = Y0;
    P.within({ p: [0, 0, -0.018] }, () => {
        const d = new THREE.Shape();
        d.moveTo(0.124, G);
        d.lineTo(0.128, G + 0.085);
        d.quadraticCurveTo(0.162, G + 0.13, 0.155, G + 0.2);          // pecho
        d.quadraticCurveTo(0.148, G + 0.262, 0.1, G + 0.277);         // cuello
        d.lineTo(-0.12, G + 0.272);                                  // lomo
        d.quadraticCurveTo(-0.186, G + 0.266, -0.19, G + 0.2);        // grupa
        d.quadraticCurveTo(-0.193, G + 0.12, -0.17, G + 0.075);
        d.lineTo(-0.168, G);
        d.lineTo(-0.112, G);                                         // pata trasera
        d.lineTo(-0.108, G + 0.07);
        d.quadraticCurveTo(-0.02, G + 0.082, 0.074, G + 0.07);        // panza
        d.lineTo(0.076, G);                                          // pata delantera
        d.closePath();
        P.metal(extrudeSide(d, 0.13, 0.02));

        // Faldón de pelo: mechones que cuelgan bajo la panza
        for (let i = 0; i < 5; i++) {
            const z = -0.088 + i * 0.036;
            for (const x of [-0.046, 0, 0.046]) {
                P.metal(cone(0.02, 0.046, 10), { p: [x, G + 0.068 + (x ? 0 : 0.008), z], r: [Math.PI, 0, 0] });
            }
        }

        // Cabeza: cráneo, hocico, barba, nariz, ojos y cejas
        P.metal(box(0.1, 0.088, 0.105, 0.032), { p: [0, G + 0.335, 0.148] });
        P.metal(box(0.074, 0.062, 0.095, 0.024), { p: [0, G + 0.308, 0.226] });
        P.metal(cone(0.036, 0.075, 12), { p: [0, G + 0.268, 0.222], r: [Math.PI, 0, 0], s: [1, 1, 1.25] });
        P.shade(sphere(0.017), { p: [0, G + 0.326, 0.273], s: [1.1, 0.85, 0.9] });
        for (const sx of [-1, 1]) {
            P.shade(sphere(0.0095, 12, 8), { p: [sx * 0.026, G + 0.35, 0.199] });
            P.metal(box(0.034, 0.016, 0.03, 0.006), { p: [sx * 0.027, G + 0.366, 0.192], r: [0.2, 0, -sx * 0.2] });
            P.metal(cone(0.03, 0.072, 12), { p: [sx * 0.034, G + 0.4, 0.13], r: [0, 0, -sx * 0.25], s: [1, 1, 0.65] });
        }
        // Cola parada, collar y placa
        P.metal(cone(0.026, 0.085, 12), { p: [0, G + 0.295, -0.176], r: [-0.4, 0, 0] });
        P.shade(torus(0.068, 0.009, 8, 28), { p: [0, G + 0.283, 0.118], r: [-0.93, 0, 0] });
        P.metal(sphere(0.013, 12, 8), { p: [0, G + 0.236, 0.176], s: [1, 1, 0.5] });
    });
}

// Sombrero de copa: ala ancha que sobresale de la placa y se curva hacia arriba a los costados,
// copa levemente acinturada que se abre arriba, y cinta oscura con moño
function buildHat(P) {
    const G = Y0;
    const oval = [1, 1, 0.9];
    const brim = lathe([[0, 0], [0.215, 0], [0.232, 0.005], [0.237, 0.012], [0.23, 0.019], [0.21, 0.021], [0, 0.021]], 64);
    bend(brim, (v) => {
        const r = Math.hypot(v.x, v.z);
        if (r > 0.14) v.y += 0.05 * ((r - 0.14) / 0.097) ** 2 * (v.x / r) ** 2;
    });
    P.metal(brim, { p: [0, G, 0], s: oval });
    P.metal(lathe([[0, 0], [0.134, 0], [0.13, 0.08], [0.127, 0.16], [0.132, 0.26], [0.142, 0.33], [0.146, 0.355],
        [0.143, 0.366], [0.132, 0.373], [0.07, 0.377], [0, 0.377]], 56), { p: [0, G + 0.012, 0], s: oval });
    P.shade(lathe([[0.133, 0], [0.139, 0.003], [0.139, 0.075], [0.13, 0.079]], 56), { p: [0, G + 0.02, 0], s: oval });
    P.shade(box(0.016, 0.06, 0.05, 0.007), { p: [0.14, G + 0.058, 0] });
}

// Barco: acorazado (casco extruido que se angosta hacia la quilla y sube en la proa, superestructura,
// puente, mástil, dos chimeneas, tres torretas con cañones y botes salvavidas)
function buildShip(P) {
    const G = Y0, H = 0.085;
    const hull = new THREE.Shape();
    hull.moveTo(0, 0.275);
    hull.quadraticCurveTo(0.074, 0.16, 0.085, 0.02);
    hull.lineTo(0.082, -0.16);
    hull.quadraticCurveTo(0.078, -0.244, 0, -0.25);
    hull.quadraticCurveTo(-0.078, -0.244, -0.082, -0.16);
    hull.lineTo(-0.085, 0.02);
    hull.quadraticCurveTo(-0.074, 0.16, 0, 0.275);
    const sheer = (z) => 0.032 * smooth((z - 0.02) / 0.25);   // arrufo: la cubierta sube hacia la proa
    const geo = extrudeTop(hull, H, 0.01);
    bend(geo, (v) => {
        const t = v.y / H;
        v.x *= 0.68 + 0.32 * t;
        v.y += t * sheer(v.z);
    });
    P.metal(geo, { p: [0, G, 0] });
    const d0 = G + H;
    const deck = (z) => d0 + sheer(z);

    // Superestructura, puente y mástil
    P.metal(box(0.1, 0.056, 0.15, 0.01), { p: [0, d0 + 0.025, -0.035] });
    P.metal(box(0.074, 0.05, 0.066, 0.01), { p: [0, d0 + 0.074, 0.015] });
    P.shade(box(0.062, 0.012, 0.006, 0.002), { p: [0, d0 + 0.083, 0.049] });
    P.metal(box(0.04, 0.028, 0.036, 0.008), { p: [0, d0 + 0.108, 0.01] });
    P.metal(cyl(0.0055, 0.007, 0.17, 8), { p: [0, d0 + 0.2, 0.006] });
    P.metal(cyl(0.004, 0.004, 0.1, 8), { p: [0, d0 + 0.245, 0.006], r: [0, 0, Math.PI / 2] });
    P.metal(cyl(0.013, 0.011, 0.018, 12), { p: [0, d0 + 0.21, 0.006] });
    P.metal(sphere(0.008, 10, 8), { p: [0, d0 + 0.29, 0.006] });

    // Chimeneas inclinadas hacia atrás
    for (const z of [-0.05, -0.105]) {
        P.within({ p: [0, d0 + 0.05, z], r: [-0.13, 0, 0] }, () => {
            P.metal(cyl(0.022, 0.026, 0.085, 16), { p: [0, 0.042, 0] });
            P.shade(cyl(0.0225, 0.0225, 0.014, 16), { p: [0, 0.08, 0] });
        });
    }

    // Torretas con dos cañones (dir: 1 hacia la proa, -1 hacia la popa)
    const turret = (z, y, dir, len) => {
        P.within({ p: [0, y, z], r: [0, dir < 0 ? Math.PI : 0, 0] }, () => {
            P.metal(cyl(0.032, 0.034, 0.016, 20), { p: [0, 0.008, 0] });
            P.metal(box(0.058, 0.03, 0.064, 0.012), { p: [0, 0.029, -0.004] });
            for (const sx of [-1, 1]) {
                P.shade(cyl(0.0055, 0.0065, len, 8), { p: [sx * 0.013, 0.03, 0.028 + len / 2], r: [Math.PI / 2, 0, 0] });
            }
        });
    };
    turret(0.155, deck(0.155) - 0.004, 1, 0.085);
    P.metal(cyl(0.034, 0.036, 0.05, 20), { p: [0, d0 + 0.02, 0.085] });   // barbeta alta de la torreta B
    turret(0.085, d0 + 0.045, 1, 0.075);
    turret(-0.175, d0 - 0.003, -1, 0.07);

    // Botes salvavidas
    for (const sx of [-1, 1]) P.shade(capsule(0.009, 0.045), { p: [sx * 0.062, d0 + 0.012, -0.06], r: [Math.PI / 2, 0, 0] });
}

// Bota: bota victoriana (caña y empeine extruidos con la punta redondeada, suela con taco, cordones, moño y tirador)
function buildBoot(P) {
    const G = Y0;
    const toe = (v) => { if (v.z > 0.09) v.x *= 1 - 0.42 * Math.min(1, (v.z - 0.09) / 0.16) ** 2; };
    P.within({ p: [0, 0, -0.035] }, () => {
        const up = new THREE.Shape();
        up.moveTo(-0.14, G + 0.03);
        up.lineTo(0.2, G + 0.03);
        up.quadraticCurveTo(0.245, G + 0.035, 0.242, G + 0.075);      // punta
        up.quadraticCurveTo(0.235, G + 0.115, 0.165, G + 0.13);
        up.quadraticCurveTo(0.075, G + 0.145, 0.045, G + 0.21);       // empeine
        up.lineTo(0.032, G + 0.44);                                  // frente de la caña
        up.quadraticCurveTo(0.036, G + 0.47, 0.052, G + 0.49);
        up.lineTo(-0.165, G + 0.49);                                 // boca
        up.quadraticCurveTo(-0.158, G + 0.465, -0.152, G + 0.44);
        up.lineTo(-0.146, G + 0.2);                                  // talón
        up.quadraticCurveTo(-0.16, G + 0.1, -0.14, G + 0.03);
        up.closePath();
        P.metal(bend(extrudeSide(up, 0.12, 0.024), toe));

        const sole = new THREE.Shape();
        sole.moveTo(-0.158, G);
        sole.lineTo(-0.075, G);                                      // taco
        sole.lineTo(-0.07, G + 0.012);
        sole.lineTo(0.07, G + 0.012);                                // arco del pie
        sole.lineTo(0.09, G);
        sole.lineTo(0.215, G);
        sole.quadraticCurveTo(0.255, G + 0.004, 0.25, G + 0.034);
        sole.lineTo(-0.16, G + 0.034);
        sole.closePath();
        P.shade(bend(extrudeSide(sole, 0.132, 0.008), toe));

        // Boca de la caña (se ve oscura, como un hueco)
        P.shade(cyl(1, 1, 0.006, 28), { p: [0, G + 0.491, -0.057], s: [0.034, 1, 0.078] });
        // Cordones cruzados sobre el frente de la caña
        for (let i = 0; i < 5; i++) {
            const y = 0.23 + i * 0.045;
            const z = 0.045 - 0.013 * (y - 0.21) / 0.23 + 0.003;
            for (const a of [1.1, -1.1]) P.shade(cyl(0.0045, 0.0045, 0.07, 8), { p: [0, G + y, z], r: [0, 0, a] });
        }
        // Moño y tirador trasero
        for (const sx of [-1, 1]) {
            P.shade(torus(0.017, 0.0048, 8, 16), { p: [sx * 0.016, G + 0.445, 0.04], r: [0, sx * 0.5, sx * 0.4] });
        }
        P.shade(torus(0.022, 0.006, 8, 18), { p: [0, G + 0.49, -0.162], r: [0, Math.PI / 2, 0] });
    });
}

// Gato sentado: cuerpo torneado, pecho, ancas, patas delanteras, cabeza con orejas, hocico, collar con cascabel
// y la cola rodeando las patas
function buildCat(P) {
    const G = Y0;
    P.metal(lathe([[0, 0], [0.098, 0], [0.112, 0.018], [0.116, 0.06], [0.108, 0.12], [0.092, 0.18], [0.076, 0.235],
        [0.064, 0.28], [0.058, 0.31], [0.04, 0.33], [0, 0.335]], 36), { p: [0, G, -0.025], r: [0.1, 0, 0], s: [0.85, 1, 0.92] });
    P.metal(sphere(0.07, 20, 14), { p: [0, G + 0.2, 0.035], s: [0.85, 1.25, 0.75] });
    for (const sx of [-1, 1]) {
        P.metal(sphere(0.07, 20, 14), { p: [sx * 0.068, G + 0.07, -0.035], s: [0.75, 0.95, 1.2] });          // anca
        P.metal(capsule(0.021, 0.15), { p: [sx * 0.034, G + 0.1, 0.075], r: [0.06, 0, 0] });                 // pata
        P.metal(sphere(0.027, 14, 10), { p: [sx * 0.036, G + 0.016, 0.09], s: [1, 0.62, 1.3] });             // mano
    }

    // Cabeza
    const HY = G + 0.395, HZ = 0.03;
    P.metal(sphere(0.088, 28, 20), { p: [0, HY, HZ], s: [1.12, 0.94, 0.95] });
    for (const sx of [-1, 1]) {
        P.metal(sphere(0.027, 14, 10), { p: [sx * 0.021, HY - 0.029, HZ + 0.07] });                           // hocico
        P.shade(sphere(0.014, 12, 8), { p: [sx * 0.036, HY + 0.015, HZ + 0.073], s: [1, 1.25, 0.55] });       // ojo
        // Oreja: pirámide con una cara hacia adelante, inclinada hacia afuera
        P.within({ p: [sx * 0.052, HY + 0.088, HZ - 0.01], r: [0, 0, -sx * 0.4], s: [1, 1, 0.5] }, () => {
            P.metal(cone(0.05, 0.08, 4), { r: [0, Math.PI / 4, 0] });
        });
    }
    P.metal(sphere(0.02, 12, 8), { p: [0, HY - 0.045, HZ + 0.068] });                                        // mentón
    P.shade(sphere(0.012, 12, 8), { p: [0, HY - 0.01, HZ + 0.088], s: [1.2, 0.8, 0.8] });                    // nariz

    // Collar con cascabel
    P.shade(torus(0.06, 0.01, 8, 28), { p: [0, G + 0.315, 0.02], r: [-1.35, 0, 0] });
    P.metal(sphere(0.014, 12, 8), { p: [0, G + 0.298, 0.08] });

    // Cola que rodea las patas delanteras
    const tail = taperedTube([[0, G + 0.04, -0.13], [0.075, G + 0.03, -0.135], [0.13, G + 0.022, -0.06],
        [0.13, G + 0.02, 0.04], [0.09, G + 0.025, 0.12], [0.045, G + 0.03, 0.14]], 0.022, 0.012);
    P.metal(tail.geo);
    P.metal(sphere(0.012, 12, 8), { p: tail.end.toArray() });
}

// Cohete: cuerpo torneado con nariz ojival, tobera, anillos, ventanilla y tres aletas que sirven de patas
function buildRocket(P) {
    const G = Y0, b = G + 0.105;
    P.metal(lathe([[0, 0], [0.062, 0], [0.078, 0.012], [0.09, 0.05], [0.098, 0.12], [0.1, 0.19], [0.097, 0.26],
        [0.088, 0.33], [0.072, 0.4], [0.05, 0.46], [0.028, 0.5], [0.01, 0.525], [0, 0.53]], 40), { p: [0, b, 0] });
    P.shade(lathe([[0, 0], [0.05, 0], [0.056, 0.008], [0.045, 0.03], [0.04, 0.06], [0, 0.06]], 28), { p: [0, b - 0.055, 0] });
    P.shade(torus(0.099, 0.007, 8, 40), { p: [0, b + 0.12, 0], r: [Math.PI / 2, 0, 0] });
    P.shade(torus(0.081, 0.007, 8, 40), { p: [0, b + 0.36, 0], r: [Math.PI / 2, 0, 0] });
    // Ventanilla (mira hacia +z)
    P.metal(torus(0.033, 0.009, 10, 28), { p: [0, b + 0.24, 0.094] });
    P.shade(sphere(0.03, 18, 12), { p: [0, b + 0.24, 0.093], s: [1, 1, 0.35] });

    // Aletas: una atrás y dos adelante a los costados, apoyadas en la placa
    const fin = new THREE.Shape();
    fin.moveTo(0.075, b + 0.26);
    fin.quadraticCurveTo(0.17, b + 0.2, 0.205, b + 0.03);
    fin.lineTo(0.215, G);
    fin.lineTo(0.17, G);
    fin.quadraticCurveTo(0.14, b + 0.02, 0.075, b + 0.05);
    fin.closePath();
    for (const phi of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
        P.metal(extrudeFlat(fin, 0.024, 0.006), { r: [0, phi - Math.PI / 2, 0] });
    }
}

const BUILDERS = {
    car: buildCar, plane: buildPlane, dog: buildDog, hat: buildHat,
    ship: buildShip, boot: buildBoot, cat: buildCat, rocket: buildRocket,
};

// Las figuras "de perfil" se giran en tres cuartos (rotación en y) sobre su base: siguen mirando hacia el jugador,
// pero así se lee su silueta (de frente, la bota o el perro parecen una columna).
const TURN = { car: 0.62, dog: 0.7, boot: 0.75, ship: 0.55 };

// ---------------------------------------------------------------------------
// Cachés de geometrías y materiales compartidos
// ---------------------------------------------------------------------------
const KIND_CACHE = new Map();
let SHARED = null;
let MATS = null;
const RIM_CACHE = new Map();

function kindGeometry(kind) {
    let entry = KIND_CACHE.get(kind);
    if (!entry) {
        const P = new Parts();
        P.metal(lathe(PLATE_PROFILE, 56));
        let extra = {};
        P.within({ r: [0, TURN[kind] || 0, 0] }, () => { extra = BUILDERS[kind](P) || {}; });
        entry = { ...P.build(), spinner: extra.spinner || null, height: null };
        KIND_CACHE.set(kind, entry);
    }
    return entry;
}

// Anillo de brillo en el suelo: degradé radial por alfa de vértice (no necesita texturas ni canvas)
function haloGeometry() {
    const inner = 0.25, outer = 0.298;
    const geo = new THREE.RingGeometry(inner, outer, 64, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.003, 0);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        const a = 1 - THREE.MathUtils.clamp((r - inner) / (outer - inner), 0, 1);
        colors.set([1, 1, 1, a], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geo.deleteAttribute('uv');
    return geo;
}

function sharedGeometry() {
    if (!SHARED) {
        SHARED = {
            base: fuse([lathe(BASE_PROFILE, 56)]),
            mine: fuse([torus(0.214, 0.0075, 8, 56).rotateX(Math.PI / 2).translate(0, 0.038, 0)]),
            ring: fuse([torus(0.27, 0.013, 10, 64).rotateX(Math.PI / 2).translate(0, 0.018, 0)]),
            halo: haloGeometry(),
        };
    }
    return SHARED;
}

function materials() {
    if (!MATS) {
        MATS = {
            pewter: new THREE.MeshStandardMaterial({ name: 'peltre', color: 0xc9cdd3, metalness: 0.92, roughness: 0.27 }),
            pewterDark: new THREE.MeshStandardMaterial({ name: 'peltre-oscuro', color: 0x62666d, metalness: 0.85, roughness: 0.4 }),
            gold: new THREE.MeshStandardMaterial({
                name: 'oro', color: 0xf0c050, metalness: 1, roughness: 0.22, emissive: 0x3d2a00, emissiveIntensity: 0.6,
            }),
        };
        Object.values(MATS).forEach((m) => { m.userData.shared = true; });
    }
    return MATS;
}

// Esmalte de la base: un material por color (compartido entre fichas del mismo color)
function rimMaterial(color) {
    const c = new THREE.Color(color);
    const key = c.getHexString();
    let m = RIM_CACHE.get(key);
    if (!m) {
        m = new THREE.MeshPhysicalMaterial({
            name: `base-${key}`, color: c, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
        });
        m.userData.shared = true;
        RIM_CACHE.set(key, m);
    }
    return m;
}

// Color del brillo del turno: el del jugador, más vivo y claro (los grises quedan casi blancos)
function glowColor(color) {
    const c = new THREE.Color(color);
    const hsl = {};
    c.getHSL(hsl, THREE.SRGBColorSpace);
    const s = hsl.s < 0.08 ? hsl.s : Math.max(hsl.s, 0.75);
    return c.setHSL(hsl.h, s, THREE.MathUtils.clamp(hsl.l, 0.55, 0.7), THREE.SRGBColorSpace);
}

function solid(geo, mat) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
export function createToken(kind, color = '#cccccc') {
    const k = BUILDERS[kind] ? kind : 'car';
    const geo = kindGeometry(k);
    const sh = sharedGeometry();
    const mat = materials();

    const group = new THREE.Group();
    group.name = `ficha-${k}`;

    const base = solid(sh.base, rimMaterial(color));
    const figure = solid(geo.metal, mat.pewter);
    group.add(base, figure);
    if (geo.shade) group.add(solid(geo.shade, mat.pewterDark));

    let spinner = null;
    if (geo.spinner) {
        const pivot = new THREE.Group();
        matrixOf(geo.spinner.pivot).decompose(pivot.position, pivot.quaternion, pivot.scale);
        spinner = solid(geo.spinner.geo, mat.pewter);
        spinner.position.fromArray(geo.spinner.offset);
        spinner.rotation.z = 0.4;
        pivot.add(spinner);
        group.add(pivot);
    }

    // Alto real del modelo (se calcula una vez por tipo)
    if (geo.height === null) {
        group.updateMatrixWorld(true);
        geo.height = new THREE.Box3().setFromObject(group).max.y;
    }

    // Resaltados: anillo dorado (ficha propia) y anillo + halo que laten (turno activo)
    const mineRing = new THREE.Mesh(sh.mine, mat.gold);
    mineRing.castShadow = true;
    mineRing.visible = false;

    const glow = glowColor(color);
    const ringMat = new THREE.MeshStandardMaterial({
        name: 'anillo-turno', color: glow.clone(), emissive: glow.clone(), emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.35,
    });
    const activeRing = new THREE.Mesh(sh.ring, ringMat);
    activeRing.castShadow = true;
    activeRing.visible = false;

    const haloMat = new THREE.MeshBasicMaterial({
        name: 'halo-turno', color: glow.clone(), vertexColors: true, transparent: true, opacity: 0.7,
        depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const halo = new THREE.Mesh(sh.halo, haloMat);   // brillo difuso sobre el tablero: no proyecta sombra
    halo.renderOrder = 1;
    halo.visible = false;

    group.add(mineRing, activeRing, halo);

    const state = { mine: false, active: false };
    Object.assign(group.userData, {
        kind: k,
        color,
        height: geo.height,
        setHighlight({ mine = false, active = false } = {}) {
            state.mine = !!mine;
            state.active = !!active;
            mineRing.visible = state.mine;
            activeRing.visible = state.active;
            halo.visible = state.active;
            if (!state.active && spinner) spinner.rotation.z = 0.4;
        },
        tick(t) {
            if (!state.active) return;
            const k2 = 0.5 + 0.5 * Math.sin(t * 4.5);
            ringMat.emissiveIntensity = 0.8 + 1.8 * k2;
            haloMat.opacity = 0.35 + 0.5 * k2;
            if (spinner) spinner.rotation.z = t * 16;
        },
        setColor(next) {
            group.userData.color = next;
            base.material = rimMaterial(next);
            const g = glowColor(next);
            ringMat.color.copy(g);
            ringMat.emissive.copy(g);
            haloMat.color.copy(g);
        },
        dispose() {
            ringMat.dispose();
            haloMat.dispose();
        },
    });
    return group;
}
