// Escena WebGL del Monopoly: renderizador, cámara con vistas, luces, mesa de madera, tablero,
// fichas, casas/hoteles, dados, mazos de cartas y destellos sobre las casillas.
// createMonoScene(contenedor, opciones) crea todo y devuelve la API que index.js publica como window.Mono3D.
// Lanza una excepción si no se puede crear el contexto WebGL (index.js lo trata como "sin 3D").
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    BOARD_SIZE, BOARD_THICKNESS, HALF, CHANCE_SLOT, CHEST_SLOT,
    cellRect, tokenSlots, posAt,
} from './layout.js';
import { drawBoard, boardSignature } from './boardTexture.js';
import { createToken, TOKEN_KINDS } from './tokens.js';
import { createHouse, createHotel, buildingPlacements } from './buildings.js';
import { createDice } from './dice.js';

// ---------- Parámetros ----------
const TEXTURA_TABLERO = 2048;            // lado del lienzo de la cara superior del tablero
const COLOR_FONDO = 0x120d09;            // oscuridad alrededor de la mesa
const COLOR_MENTA = '#cfe6d3';           // base del tablero antes de recibir el primer estado

const GRADO = Math.PI / 180;
// Vistas predefinidas: elevación de la cámara sobre la horizontal (desde +z, la fila de la Salida cerca)
const VISTAS = [
    { nombre: '3D', elevacion: 50 * GRADO },
    { nombre: 'baja', elevacion: 28 * GRADO },
    { nombre: 'superior', elevacion: 85 * GRADO },
];
const ELEVACION_MIN = 10 * GRADO;        // límites del arrastre con el mouse
const ELEVACION_MAX = 85 * GRADO;
const FOV = 36;
const MARGEN_ENCUADRE = 0.97;            // el tablero ocupa como máximo este tanto de la pantalla (NDC)
const ZOOM_MAX = 1.7;                    // cuánto puede alejarse el usuario respecto del encuadre justo
const DUR_VISTA = 0.6;

const DUR_SALTITO = 0.24, ALTURA_SALTITO = 0.35;   // paso casilla a casilla
const DUR_SALTO = 0.6, ALTURA_SALTO = 3;           // salto largo (cartas, ir a la cárcel)
const DUR_DESLIZ = 0.2;                            // reacomodo dentro de la misma casilla
const DUR_DESTELLO = 1.2;
const DUR_CARTA = 1.5;
const DUR_CRECER = 0.35;

const CARTAS_POR_MAZO = 12;
const CARTA = { ancho: 1.72, fondo: 1.06, grosor: 0.016, radio: 0.08 };

const PLANO_TABLERO = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const OBJETIVO = new THREE.Vector3(0, 0, 0);

// ---------- Utilidades ----------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const suave = (t) => t * t * (3 - 2 * t);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const reloj = () => performance.now() / 1000;
const esCasilla = (pos) => Number.isInteger(pos) && pos >= 0 && pos < 40;

function diferenciaAngular(desde, hasta) {
    let d = (hasta - desde) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// Generador pseudoaleatorio con semilla (mulberry32): la madera y los mazos salen iguales siempre.
function generadorAzar(semilla) {
    let a = semilla >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function crearLienzo(ancho, alto) {
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    return lienzo;
}

function texturaDeLienzo(lienzo, anisotropia = 1) {
    const tex = new THREE.CanvasTexture(lienzo);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropia;
    return tex;
}

// Reúne geometrías, materiales y texturas de un objeto y sus hijos.
function recursosDe(raiz, recursos = { geometrias: new Set(), materiales: new Set(), texturas: new Set() }) {
    raiz.traverse((obj) => {
        if (obj.geometry) recursos.geometrias.add(obj.geometry);
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const mat of mats) {
            recursos.materiales.add(mat);
            for (const valor of Object.values(mat)) if (valor && valor.isTexture) recursos.texturas.add(valor);
        }
    });
    return recursos;
}

function liberarRecursos({ geometrias, materiales, texturas }) {
    geometrias.forEach(g => g.dispose());
    materiales.forEach(m => m.dispose());
    texturas.forEach(t => t.dispose());
}

function activarSombras(obj) {
    obj.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
}

// ---------- Texturas procedurales ----------

// Madera de la mesa: tablones con vetas onduladas, nudos y juntas. Se repite sin cortes.
function crearTexturaMadera(anisotropia) {
    const N = 1024, TABLAS = 5, anchoTabla = N / TABLAS;
    const lienzo = crearLienzo(N, N);
    const ctx = lienzo.getContext('2d');
    const azar = generadorAzar(20240611);

    for (let i = 0; i < TABLAS; i++) {
        const x0 = i * anchoTabla;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, anchoTabla, N);
        ctx.clip();

        const tono = 22 + azar() * 8, sat = 45 + azar() * 12, luz = 25 + azar() * 8;
        const base = ctx.createLinearGradient(x0, 0, x0 + anchoTabla, 0);
        base.addColorStop(0, `hsl(${tono}, ${sat}%, ${luz - 2}%)`);
        base.addColorStop(0.5, `hsl(${tono + 2}, ${sat}%, ${luz + 2}%)`);
        base.addColorStop(1, `hsl(${tono}, ${sat}%, ${luz - 3}%)`);
        ctx.fillStyle = base;
        ctx.fillRect(x0, 0, anchoTabla, N);

        // Vetas: curvas periódicas en vertical para que la textura empalme consigo misma
        for (let k = 0; k < 80; k++) {
            const bx = x0 + azar() * anchoTabla;
            const amp = 2 + azar() * 8;
            const ciclos = 1 + Math.floor(azar() * 3);
            const fase = azar() * Math.PI * 2;
            const oscura = azar() < 0.68;
            ctx.strokeStyle = oscura
                ? `rgba(38, 18, 6, ${0.07 + azar() * 0.18})`
                : `rgba(255, 214, 160, ${0.03 + azar() * 0.07})`;
            ctx.lineWidth = 0.6 + azar() * 2.4;
            ctx.beginPath();
            for (let y = 0; y <= N; y += 8) {
                const ang = (y / N) * Math.PI * 2;
                const x = bx + Math.sin(ang * ciclos + fase) * amp + Math.sin(ang * (ciclos + 3) + fase * 2) * amp * 0.3;
                if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Algún nudo con anillos
        if (azar() < 0.7) {
            const nx = x0 + anchoTabla * (0.25 + azar() * 0.5), ny = 60 + azar() * (N - 120);
            for (let a = 6; a >= 1; a--) {
                ctx.strokeStyle = `rgba(35, 15, 5, ${0.1 + (6 - a) * 0.05})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.ellipse(nx, ny, a * 3.2, a * 9, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Juntas: entre tablas y una unión transversal a distinta altura en cada tabla
        ctx.fillStyle = 'rgba(12, 6, 2, 0.6)';
        ctx.fillRect(x0, 0, 3, N);
        ctx.fillStyle = 'rgba(255, 222, 180, 0.07)';
        ctx.fillRect(x0 + 3, 0, 2, N);
        ctx.fillStyle = 'rgba(12, 6, 2, 0.45)';
        ctx.fillRect(x0, azar() * N, anchoTabla, 2.5);
        ctx.restore();
    }

    const tex = texturaDeLienzo(lienzo, anisotropia);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7.5, 7.5);
    return tex;
}

// Cantos de la losa: el papel menta del tablero dobla sobre el borde y abajo asoma el cartón.
function crearTexturaCanto() {
    const lienzo = crearLienzo(8, 64);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = COLOR_MENTA;
    ctx.fillRect(0, 0, 8, 26);
    ctx.fillStyle = '#9fbfa6';
    ctx.fillRect(0, 26, 8, 2);
    const carton = ctx.createLinearGradient(0, 28, 0, 64);
    carton.addColorStop(0, '#b9ab8e');
    carton.addColorStop(1, '#8c7f67');
    ctx.fillStyle = carton;
    ctx.fillRect(0, 28, 8, 36);
    ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
    for (let y = 34; y < 62; y += 7) ctx.fillRect(0, y, 8, 1);
    return texturaDeLienzo(lienzo);
}

// Borde luminoso para los destellos de casilla (alfa: fuerte en el borde, suave al centro).
function crearTexturaDestello() {
    const N = 128;
    const lienzo = crearLienzo(N, N);
    const ctx = lienzo.getContext('2d');
    const centro = ctx.createRadialGradient(N / 2, N / 2, N * 0.1, N / 2, N / 2, N * 0.72);
    centro.addColorStop(0, 'rgba(255,255,255,0.35)');
    centro.addColorStop(1, 'rgba(255,255,255,0.6)');
    ctx.fillStyle = centro;
    ctx.fillRect(0, 0, N, N);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, N - 10, N - 10);
    return texturaDeLienzo(lienzo);
}

function rectanguloRedondeado(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Cofre simple (Arca Comunal) dibujado con trazos, sin depender de fuentes de emoji.
function dibujarCofre(ctx, cx, cy, s, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.07;
    // tapa curva
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.55, -s * 0.5, 0, -s * 0.52);
    ctx.quadraticCurveTo(s * 0.55, -s * 0.5, s * 0.55, -s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // cuerpo
    ctx.fillRect(-s * 0.55, -s * 0.05, s * 1.1, s * 0.55);
    ctx.strokeRect(-s * 0.55, -s * 0.05, s * 1.1, s * 0.55);
    // cerradura
    ctx.fillStyle = color;
    ctx.fillRect(-s * 0.1, -s * 0.14, s * 0.2, s * 0.26);
    ctx.restore();
}

// Dorso de las cartas (lo que se ve sobre el mazo): color del mazo, marco y título.
function crearTexturaDorso({ color, titulo, esArca }) {
    const W = 512, H = 316;
    const lienzo = crearLienzo(W, H);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    const brillo = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H / 2, W * 0.6);
    brillo.addColorStop(0, 'rgba(255,255,255,0.22)');
    brillo.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = brillo;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 8;
    rectanguloRedondeado(ctx, 18, 18, W - 36, H - 36, 22);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (esArca) {
        dibujarCofre(ctx, W / 2, H * 0.44, 120, color);
    } else {
        ctx.font = 'bold 170px "Arial Black", Arial, sans-serif';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(90, 35, 0, 0.55)';
        ctx.strokeText('?', W / 2, H * 0.42);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('?', W / 2, H * 0.42);
    }
    ctx.font = `bold ${esArca ? 40 : 50}px "Arial Black", Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(titulo, W / 2, H * 0.8);
    return texturaDeLienzo(lienzo, 4);
}

// Frente de la carta (se ve al darla vuelta): cartulina clara con encabezado de color.
function crearTexturaFrente({ color, titulo, esArca }) {
    const W = 512, H = 316;
    const lienzo = crearLienzo(W, H);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, 86);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px "Arial Black", Arial, sans-serif';
    ctx.fillText(titulo, W / 2, 46);
    // renglones que sugieren el texto de la carta (el texto real lo muestra la interfaz HTML)
    ctx.fillStyle = 'rgba(60, 50, 40, 0.28)';
    for (let i = 0; i < 4; i++) {
        const w = [360, 400, 330, 220][i];
        ctx.fillRect((W - w) / 2, 128 + i * 38, w, 12);
    }
    if (esArca) dibujarCofre(ctx, W - 60, H - 52, 46, color);
    else {
        ctx.fillStyle = color;
        ctx.font = 'bold 64px "Arial Black", Arial, sans-serif';
        ctx.fillText('?', W - 56, H - 48);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    return texturaDeLienzo(lienzo, 4);
}

// Carta con esquinas redondeadas, apoyada sobre y = 0 (grosor hacia +y).
// Las UV de las tapas cubren la carta completa: la parte de arriba del lienzo queda hacia -z local.
function crearGeometriaCarta() {
    const { ancho: w, fondo: d, grosor, radio: r } = CARTA;
    const forma = new THREE.Shape();
    forma.moveTo(-w / 2 + r, -d / 2);
    forma.lineTo(w / 2 - r, -d / 2);
    forma.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    forma.lineTo(w / 2, d / 2 - r);
    forma.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    forma.lineTo(-w / 2 + r, d / 2);
    forma.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    forma.lineTo(-w / 2, -d / 2 + r);
    forma.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    const geo = new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: false, curveSegments: 5 });
    geo.rotateX(-Math.PI / 2);   // (x, y, z) -> (x, z, -y): la forma queda en XZ y el grosor en +y
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, pos.getX(i) / w + 0.5, 0.5 - pos.getZ(i) / d);
    }
    uv.needsUpdate = true;
    return geo;
}

// Márgenes en píxeles (top, right, bottom, left) saneados: números >= 0.
function margenesValidos(m) {
    const v = (x) => Math.max(0, Number(x) || 0);
    return { top: v(m?.top), right: v(m?.right), bottom: v(m?.bottom), left: v(m?.left) };
}

// ---------- Escena ----------
// opciones.view: vista inicial (0..2). opciones.insets: píxeles del lienzo tapados por la interfaz HTML
// ({ top, right, bottom, left }); el tablero se encuadra y se centra en el resto (ver setInsets).
export function createMonoScene(contenedor, { view = 0, insets = null } = {}) {
    if (!contenedor) throw new Error('Mono3D: falta el contenedor');

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    // En r186 PCFSoftShadowMap fue retirado: PCFShadowMap con shadow.radius da la sombra suave.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const eventos = new AbortController();
    const opcionesEvento = { signal: eventos.signal };

    // Lienzo a pantalla completa dentro del contenedor
    const lienzo = renderer.domElement;
    lienzo.className = 'mono3d-canvas';
    Object.assign(lienzo.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', outline: 'none', cursor: 'grab',
    });
    const posicionPrevia = contenedor.style.position;
    if (getComputedStyle(contenedor).position === 'static') contenedor.style.position = 'relative';
    contenedor.appendChild(lienzo);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_FONDO);
    scene.fog = new THREE.Fog(COLOR_FONDO, 34, 82);

    // Reflejos para el metal de las fichas (se guarda el render target para liberarlo después)
    let entorno = null;
    function crearEntorno() {
        entorno?.dispose();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const sala = new RoomEnvironment();
        entorno = pmrem.fromScene(sala, 0.04);
        sala.dispose();
        pmrem.dispose();
        scene.environment = entorno.texture;
    }
    crearEntorno();
    scene.environmentIntensity = 0.6;

    // Luces: principal cálida con sombras + relleno de cielo/suelo
    const luzCielo = new THREE.HemisphereLight(0xfff3e2, 0x2a1b10, 0.55);
    const sol = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sol.position.set(5.5, 14, 7.5);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    Object.assign(sol.shadow.camera, { left: -9.5, right: 9.5, top: 9.5, bottom: -9.5, near: 2, far: 40 });
    sol.shadow.bias = -0.0005;
    sol.shadow.normalBias = 0.02;
    sol.shadow.radius = 4;
    scene.add(luzCielo, sol, sol.target);

    // Mesa de madera con viñeta (colores por vértice que oscurecen hacia los bordes)
    const geoMesa = new THREE.PlaneGeometry(90, 90, 36, 36);
    geoMesa.rotateX(-Math.PI / 2);
    {
        const pos = geoMesa.attributes.position;
        const colores = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            const d = Math.hypot(pos.getX(i), pos.getZ(i));
            const f = 1 - 0.86 * suave(clamp01((d - 7) / 32));
            colores.set([f, f * 0.97, f * 0.94], i * 3);
        }
        geoMesa.setAttribute('color', new THREE.BufferAttribute(colores, 3));
    }
    const mesa = new THREE.Mesh(geoMesa, new THREE.MeshStandardMaterial({
        map: crearTexturaMadera(anisotropia), vertexColors: true, roughness: 0.55, metalness: 0,
    }));
    mesa.name = 'mesa';
    mesa.position.y = -BOARD_THICKNESS - 0.001;
    mesa.receiveShadow = true;
    scene.add(mesa);

    // Tablero: losa con la cara superior en y = 0. La textura usa las UV de BoxGeometry, que
    // cumplen el mapeo de layout.js: u = (x + HALF) / BOARD_SIZE y (con flipY) fila del lienzo = z.
    const lienzoTablero = crearLienzo(TEXTURA_TABLERO, TEXTURA_TABLERO);
    const ctxTablero = lienzoTablero.getContext('2d');
    ctxTablero.fillStyle = COLOR_MENTA;
    ctxTablero.fillRect(0, 0, TEXTURA_TABLERO, TEXTURA_TABLERO);
    const texTablero = texturaDeLienzo(lienzoTablero, renderer.capabilities.getMaxAnisotropy());
    const geoLosa = new THREE.BoxGeometry(BOARD_SIZE, BOARD_THICKNESS, BOARD_SIZE);
    geoLosa.translate(0, -BOARD_THICKNESS / 2, 0);
    const matCanto = new THREE.MeshStandardMaterial({ map: crearTexturaCanto(), roughness: 0.85 });
    const matCara = new THREE.MeshStandardMaterial({ map: texTablero, roughness: 0.62, metalness: 0 });
    const matBase = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.9 });
    // Grupos de BoxGeometry: +x, -x, +y (cara superior), -y, +z, -z
    const losa = new THREE.Mesh(geoLosa, [matCanto, matCanto, matCara, matBase, matCanto, matCanto]);
    losa.name = 'tablero';
    losa.castShadow = true;
    losa.receiveShadow = true;
    scene.add(losa);
    let firmaTablero = null;
    let tableroSincronizado = false;
    let ultimoEstado = null;

    // ---------- Mazos de cartas ----------
    const geoCarta = crearGeometriaCarta();
    const geoFrenteCarta = new THREE.PlaneGeometry(CARTA.ancho * 0.97, CARTA.fondo * 0.97);
    geoFrenteCarta.rotateX(Math.PI / 2);   // mira hacia abajo; al voltear la carta queda hacia arriba
    const matCantoCarta = new THREE.MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.8 });

    function crearMazo(slot, estilo, semilla) {
        const grupo = new THREE.Group();
        grupo.name = `mazo-${estilo.titulo}`;
        grupo.position.set(slot.cx, 0, slot.cz);
        grupo.rotation.y = slot.rot;
        const matDorso = new THREE.MeshStandardMaterial({ map: crearTexturaDorso(estilo), roughness: 0.5 });
        const matFrente = new THREE.MeshStandardMaterial({ map: crearTexturaFrente(estilo), roughness: 0.55 });

        // Pila (todas menos la de arriba) en un solo InstancedMesh, levemente desordenada
        const azar = generadorAzar(semilla);
        const pila = new THREE.InstancedMesh(geoCarta, [matDorso, matCantoCarta], CARTAS_POR_MAZO - 1);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
        const eje = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < CARTAS_POR_MAZO - 1; i++) {
            p.set((azar() - 0.5) * 0.04, i * CARTA.grosor, (azar() - 0.5) * 0.04);
            q.setFromAxisAngle(eje, (azar() - 0.5) * 0.05);
            pila.setMatrixAt(i, m.compose(p, q, s));
        }
        pila.castShadow = true;
        pila.receiveShadow = true;

        const baseY = (CARTAS_POR_MAZO - 1) * CARTA.grosor;
        const superior = new THREE.Group();
        superior.position.y = baseY;
        superior.rotation.order = 'YXZ';   // primero se voltea sobre su eje X y luego gira hacia la cámara
        const cartaSuperior = new THREE.Mesh(geoCarta, [matDorso, matCantoCarta]);
        const frente = new THREE.Mesh(geoFrenteCarta, matFrente);
        frente.position.y = -0.0006;
        cartaSuperior.castShadow = cartaSuperior.receiveShadow = true;
        superior.add(cartaSuperior, frente);
        grupo.add(pila, superior);
        scene.add(grupo);
        return { grupo, superior, baseY, giro: slot.rot, anim: null };
    }

    const mazos = {
        chance: crearMazo(CHANCE_SLOT, { color: '#f7941d', titulo: 'SUERTE', esArca: false }, 11),
        chest: crearMazo(CHEST_SLOT, { color: '#1f64b0', titulo: 'ARCA COMUNAL', esArca: true }, 29),
    };

    function drawCard(deck) {
        const mazo = mazos[deck === 'chest' ? 'chest' : 'chance'];
        if (mazo.anim) return;   // ya hay una carta en el aire: se ignoran los disparos repetidos
        mazo.anim = { t0: reloj() };
        despertar();
    }

    function animarMazos(ahora) {
        for (const mazo of Object.values(mazos)) {
            if (!mazo.anim) continue;
            const u = clamp01((ahora - mazo.anim.t0) / DUR_CARTA);
            // sube, se da vuelta mirando hacia la cámara (+z del mundo), se muestra un momento y vuelve
            const k = u < 0.3 ? easeOutCubic(u / 0.3) : u < 0.68 ? 1 : 1 - easeInOutCubic((u - 0.68) / 0.32);
            const hacia = 0.4 * k;   // se acerca un poco al jugador; en coordenadas locales del mazo
            mazo.superior.position.set(-hacia * Math.sin(mazo.giro), mazo.baseY + k * 0.95, hacia * Math.cos(mazo.giro));
            mazo.superior.rotation.set(k * (Math.PI + 0.4), -mazo.giro * k, 0);
            if (u >= 1) {
                mazo.anim = null;
                mazo.superior.position.set(0, mazo.baseY, 0);
                mazo.superior.rotation.set(0, 0, 0);
            }
        }
    }

    // ---------- Dados ----------
    const dados = createDice(scene);

    // ---------- Casas y hoteles ----------
    const edificios = new Map();              // pos -> { casas, objetos }
    const reservaEdificios = { house: [], hotel: [] };
    let crecimientos = [];                    // animación de aparición { obj, t0 }

    function nuevoEdificio(tipo) {
        const obj = tipo === 'hotel' ? createHotel() : createHouse();
        obj.userData.tipoEdificio = tipo;
        activarSombras(obj);
        return obj;
    }

    function guardarEdificio(obj) {
        obj.removeFromParent();
        obj.scale.set(1, 1, 1);
        crecimientos = crecimientos.filter(c => c.obj !== obj);
        reservaEdificios[obj.userData.tipoEdificio].push(obj);
    }

    function sincronizarEdificios(board, animar) {
        const ahora = reloj();
        for (let pos = 0; pos < 40; pos++) {
            const celda = board[pos];
            const casas = celda && celda.type === 'property' ? Math.max(0, Math.min(5, Math.floor(Number(celda.houses) || 0))) : 0;
            const previo = edificios.get(pos);
            const antes = previo ? previo.casas : 0;
            if (casas === antes) continue;
            if (previo) previo.objetos.forEach(guardarEdificio);
            if (!casas) { edificios.delete(pos); continue; }
            const objetos = buildingPlacements(pos, casas).map((c, i) => {
                const tipo = c.kind === 'hotel' ? 'hotel' : 'house';
                const obj = reservaEdificios[tipo].pop() || nuevoEdificio(tipo);
                obj.position.set(c.x, 0, c.z);
                obj.rotation.set(0, c.yaw || 0, 0);
                scene.add(obj);
                const esNuevo = casas > antes && (tipo === 'hotel' || i >= antes);
                if (animar && esNuevo) {
                    obj.scale.set(0.6, 0.001, 0.6);
                    crecimientos.push({ obj, t0: ahora + (i - (tipo === 'hotel' ? 0 : antes)) * 0.08 });
                }
                return obj;
            });
            edificios.set(pos, { casas, objetos });
        }
    }

    function animarCrecimientos(ahora) {
        if (!crecimientos.length) return;
        crecimientos = crecimientos.filter(({ obj, t0 }) => {
            const u = clamp01((ahora - t0) / DUR_CRECER);
            const e = easeOutBack(u);
            const lado = 0.6 + 0.4 * easeOutCubic(u);
            obj.scale.set(lado, Math.max(0.001, e), lado);
            if (u >= 1) { obj.scale.set(1, 1, 1); return false; }
            return true;
        });
    }

    function setBoard(state) {
        if (!state || !Array.isArray(state.board)) return;
        ultimoEstado = state;
        const firma = boardSignature(state);
        if (firma !== firmaTablero) {
            ctxTablero.save();
            ctxTablero.setTransform(1, 0, 0, 1, 0, 0);
            ctxTablero.fillStyle = COLOR_MENTA;
            ctxTablero.fillRect(0, 0, TEXTURA_TABLERO, TEXTURA_TABLERO);
            drawBoard(ctxTablero, TEXTURA_TABLERO, state);
            ctxTablero.restore();
            texTablero.needsUpdate = true;
            firmaTablero = firma;
        }
        // En la primera sincronización las casas aparecen sin animación
        sincronizarEdificios(state.board, tableroSincronizado);
        tableroSincronizado = true;
        despertar();
    }

    // ---------- Fichas ----------
    const fichas = new Map();   // pid -> { pid, kind, color, obj, pos, jailed, x, z, yaw, s, anim, mine, active }

    function quitarObjeto(obj) {
        obj.removeFromParent();
        if (typeof obj.userData.dispose === 'function') { obj.userData.dispose(); return; }
        // Libera solo lo que ya no usa ningún otro objeto de la escena ni está marcado como compartido
        const propios = recursosDe(obj);
        const enUso = recursosDe(scene);
        for (const r of Object.values(reservaEdificios).flat()) recursosDe(r, enUso);
        const libre = (conjunto) => (r) => !conjunto.has(r) && r.userData?.shared !== true;
        liberarRecursos({
            geometrias: [...propios.geometrias].filter(libre(enUso.geometrias)),
            materiales: [...propios.materiales].filter(libre(enUso.materiales)),
            texturas: [...propios.texturas].filter(libre(enUso.texturas)),
        });
    }

    function poseFicha(ficha, a, u) {
        const { obj } = ficha;
        let e, y, yaw;
        if (a.tipo === 'salto') {
            // sube alto, cruza y cae casi en vertical sobre la casilla, con un pequeño rebote
            e = suave(clamp01(u / 0.62));
            if (u < 0.3) { const s = u / 0.3; y = ALTURA_SALTO * (1 - (1 - s) * (1 - s)); }
            else if (u < 0.78) { const s = (u - 0.3) / 0.48; y = ALTURA_SALTO * (1 - s * s); }
            else { const s = (u - 0.78) / 0.22; y = 4 * 0.14 * s * (1 - s); }
            yaw = a.desde.yaw + (a.dYaw + a.vuelta) * suave(clamp01(u / 0.75));
        } else if (a.tipo === 'saltito') {
            e = 0.5 - Math.cos(Math.PI * u) / 2;
            y = 4 * ALTURA_SALTITO * u * (1 - u);
            yaw = a.desde.yaw + a.dYaw * e;
        } else {
            e = suave(u);
            y = 0;
            yaw = a.desde.yaw + a.dYaw * e;
        }
        obj.position.set(a.desde.x + (ficha.x - a.desde.x) * e, y, a.desde.z + (ficha.z - a.desde.z) * e);
        obj.rotation.y = yaw;
        obj.scale.setScalar(a.desde.s + (ficha.s - a.desde.s) * e);
    }

    function dejarFichaEnSuLugar(ficha) {
        ficha.anim = null;
        ficha.obj.position.set(ficha.x, 0, ficha.z);
        ficha.obj.rotation.y = ficha.yaw;
        ficha.obj.scale.setScalar(ficha.s);
    }

    function animarFichas(ahora) {
        for (const ficha of fichas.values()) {
            const a = ficha.anim;
            if (a) {
                const u = clamp01((ahora - a.t0) / a.dur);
                if (u >= 1) dejarFichaEnSuLugar(ficha);
                else poseFicha(ficha, a, u);
            }
            ficha.obj.userData.tick?.(ahora);
        }
    }

    // Escala para que varias fichas en una misma casilla no se encimen demasiado
    function escalaPorLugares(lugares) {
        // Las fichas se muestran más grandes que su tamaño de modelo para que se lean bien desde la cámara
        const TAMANO = 1.4;
        if (lugares.length < 2) return TAMANO;
        let min = Infinity;
        for (let i = 0; i < lugares.length; i++) {
            for (let j = i + 1; j < lugares.length; j++) {
                min = Math.min(min, Math.hypot(lugares[i].x - lugares[j].x, lugares[i].z - lugares[j].z));
            }
        }
        return TAMANO * Math.max(0.62, Math.min(1, min / 0.6));
    }

    function setTokens(list, { movingPid = null, effect = 'hop' } = {}) {
        const lista = (Array.isArray(list) ? list : []).filter(t => t && t.pid != null && esCasilla(t.pos));
        const ahora = reloj();
        // Si llega un estado nuevo en medio de una animación, la anterior termina de golpe
        for (const ficha of fichas.values()) if (ficha.anim) dejarFichaEnSuLugar(ficha);

        const vigentes = new Set(lista.map(t => t.pid));
        for (const [pid, ficha] of fichas) {
            if (!vigentes.has(pid)) { quitarObjeto(ficha.obj); fichas.delete(pid); }
        }

        const porCasilla = new Map();
        for (const t of lista) {
            const clave = `${t.pos}|${t.jailed ? 1 : 0}`;
            if (!porCasilla.has(clave)) porCasilla.set(clave, []);
            porCasilla.get(clave).push(t);
        }

        for (const grupo of porCasilla.values()) {
            const { pos, jailed } = grupo[0];
            const lugares = tokenSlots(pos, grupo.length, { jailed: !!jailed });
            const escala = escalaPorLugares(lugares);
            const yaw = cellRect(pos).yaw;
            grupo.forEach((t, i) => {
                const lugar = lugares[i];
                const kind = TOKEN_KINDS.includes(t.kind) ? t.kind : TOKEN_KINDS[0];
                let ficha = fichas.get(t.pid);
                if (ficha && ficha.kind === kind && ficha.color !== t.color && typeof ficha.obj.userData.setColor === 'function') {
                    ficha.obj.userData.setColor(t.color);   // mismo modelo, solo cambia el color del jugador
                    ficha.color = t.color;
                }
                if (ficha && (ficha.kind !== kind || ficha.color !== t.color)) {
                    quitarObjeto(ficha.obj);
                    fichas.delete(t.pid);
                    ficha = null;
                }
                const mine = !!t.mine, active = !!t.active;
                if (!ficha) {
                    const obj = createToken(kind, t.color);
                    obj.name = `ficha-${t.pid}`;
                    scene.add(obj);
                    ficha = { pid: t.pid, kind, color: t.color, obj, pos, jailed: !!jailed, x: lugar.x, z: lugar.z, yaw, s: escala, anim: null, mine: null, active: null };
                    fichas.set(t.pid, ficha);
                    dejarFichaEnSuLugar(ficha);
                } else {
                    const desde = { x: ficha.x, z: ficha.z, yaw: ficha.yaw, s: ficha.s };
                    const seMueve = Math.hypot(lugar.x - ficha.x, lugar.z - ficha.z) > 1e-3;
                    const cambia = seMueve || Math.abs(diferenciaAngular(ficha.yaw, yaw)) > 1e-3 || Math.abs(escala - ficha.s) > 1e-3;
                    Object.assign(ficha, { pos, jailed: !!jailed, x: lugar.x, z: lugar.z, yaw, s: escala });
                    if (t.pid === movingPid && (seMueve || cambia)) {
                        const salto = effect === 'jump';
                        ficha.anim = {
                            tipo: salto ? 'salto' : 'saltito',
                            t0: ahora,
                            dur: salto ? DUR_SALTO : DUR_SALTITO,
                            desde,
                            dYaw: diferenciaAngular(desde.yaw, yaw),
                            vuelta: Math.PI * 2 * (Math.random() < 0.5 ? -1 : 1),
                        };
                    } else if (cambia) {
                        ficha.anim = { tipo: 'desliz', t0: ahora, dur: DUR_DESLIZ, desde, dYaw: diferenciaAngular(desde.yaw, yaw) };
                    }
                }
                if (ficha.mine !== mine || ficha.active !== active) {
                    ficha.mine = mine;
                    ficha.active = active;
                    ficha.obj.userData.setHighlight?.({ mine, active });
                }
            });
        }
        despertar();
    }

    // ---------- Destellos de casilla ----------
    const geoDestello = new THREE.PlaneGeometry(1, 1);
    geoDestello.rotateX(-Math.PI / 2);
    let texDestello = null;
    const destellos = [];

    function flashCell(pos, colorHex = '#ffd700') {
        if (!esCasilla(pos)) return;
        texDestello ||= crearTexturaDestello();
        const r = cellRect(pos);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(colorHex),
            map: texDestello,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        const malla = new THREE.Mesh(geoDestello, material);
        malla.position.set(r.cx, 0.002, r.cz);
        malla.scale.set(r.w, 1, r.d);
        malla.renderOrder = 2;
        scene.add(malla);
        destellos.push({ malla, t0: reloj() });
        despertar();
    }

    function animarDestellos(ahora) {
        for (let i = destellos.length - 1; i >= 0; i--) {
            const { malla, t0 } = destellos[i];
            const u = clamp01((ahora - t0) / DUR_DESTELLO);
            // entra rápido, se mantiene un momento y se apaga
            const brillo = u < 0.1 ? u / 0.1 : u < 0.4 ? 1 : 1 - suave((u - 0.4) / 0.6);
            malla.material.opacity = 0.9 * brillo * (0.85 + 0.15 * Math.cos(u * Math.PI * 6));
            if (u >= 1) {
                malla.removeFromParent();
                malla.material.dispose();
                destellos.splice(i, 1);
            }
        }
    }

    // ---------- Cámara y controles ----------
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 300);
    const camaraEncuadre = new THREE.PerspectiveCamera(FOV, 1, 0.3, 300);
    const puntosEncuadre = [];
    for (const x of [-HALF, HALF]) for (const z of [-HALF, HALF]) for (const y of [0.3, -BOARD_THICKNESS]) {
        puntosEncuadre.push(new THREE.Vector3(x, y, z));
    }
    const _v = new THREE.Vector3();
    const _ndc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    function posicionOrbital(elev, azimut, distancia, destino) {
        return destino.set(
            Math.sin(azimut) * Math.cos(elev) * distancia,
            Math.sin(elev) * distancia,
            Math.cos(azimut) * Math.cos(elev) * distancia,
        ).add(OBJETIVO);
    }

    function esfericasActuales() {
        _v.copy(camera.position).sub(OBJETIVO);
        const r = _v.length();
        return { r, elev: Math.asin(clamp01(_v.y / r)), az: Math.atan2(_v.x, _v.z) };
    }

    // Rectángulo (en NDC) que ocupa el tablero visto desde camaraEncuadre, sin desplazamiento de vista
    const limites = { x0: 0, x1: 0, y0: 0, y1: 0, delante: true };
    function limitesEnPantalla() {
        camaraEncuadre.updateMatrixWorld();
        limites.x0 = limites.y0 = Infinity;
        limites.x1 = limites.y1 = -Infinity;
        limites.delante = true;
        for (const p of puntosEncuadre) {
            _v.copy(p).project(camaraEncuadre);
            if (_v.z < -1 || _v.z > 1) limites.delante = false;
            limites.x0 = Math.min(limites.x0, _v.x); limites.x1 = Math.max(limites.x1, _v.x);
            limites.y0 = Math.min(limites.y0, _v.y); limites.y1 = Math.max(limites.y1, _v.y);
        }
        return limites;
    }

    // Márgenes (px) que tapa la interfaz HTML encima del lienzo, p. ej. el panel de abajo
    const margenes = margenesValidos(insets);
    let versionMargenes = 0;

    // Zona útil del lienzo (sin los márgenes): fracción del ancho/alto y su centro en NDC.
    // Los márgenes nunca se comen más del 70 % de cada eje.
    function zonaUtil() {
        if (!ancho || !alto) return { fx: 1, fy: 1, cx: 0, cy: 0 };
        const kx = Math.min(1, (ancho * 0.7) / (margenes.left + margenes.right || 1));
        const ky = Math.min(1, (alto * 0.7) / (margenes.top + margenes.bottom || 1));
        const l = margenes.left * kx, r = margenes.right * kx, t = margenes.top * ky, b = margenes.bottom * ky;
        return { fx: (ancho - l - r) / ancho, fy: (alto - t - b) / alto, cx: (l - r) / ancho, cy: (b - t) / alto };
    }

    // Distancia mínima para que el tablero completo quepa en la zona útil con esa orientación
    // (ya centrado con setViewOffset, así que cuenta el tamaño del rectángulo y no su posición).
    function distanciaEncuadre(elev, azimut) {
        camaraEncuadre.aspect = camera.aspect;
        camaraEncuadre.updateProjectionMatrix();
        const zona = zonaUtil();
        const cabe = (d) => {
            posicionOrbital(elev, azimut, d, camaraEncuadre.position);
            camaraEncuadre.lookAt(OBJETIVO);
            const l = limitesEnPantalla();
            return l.delante && l.x1 - l.x0 <= 2 * MARGEN_ENCUADRE * zona.fx && l.y1 - l.y0 <= 2 * MARGEN_ENCUADRE * zona.fy;
        };
        let cerca = 3, lejos = 150;
        for (let i = 0; i < 24; i++) {
            const medio = (cerca + lejos) / 2;
            if (cabe(medio)) lejos = medio; else cerca = medio;
        }
        return lejos;
    }

    // Encuadre para la orientación actual de la cámara (se recalcula solo si cambió algo)
    const encuadre = { elev: NaN, az: NaN, aspect: NaN, ancho: NaN, alto: NaN, margenes: -1, d: 20 };
    function encuadreActual() {
        const { elev, az } = esfericasActuales();
        if (Math.abs(elev - encuadre.elev) > 0.003 || Math.abs(diferenciaAngular(az, encuadre.az)) > 0.003
            || encuadre.aspect !== camera.aspect || encuadre.ancho !== ancho || encuadre.alto !== alto
            || encuadre.margenes !== versionMargenes) {
            Object.assign(encuadre, { elev, az, aspect: camera.aspect, ancho, alto, margenes: versionMargenes, d: distanciaEncuadre(elev, az) });
        }
        return encuadre.d;
    }

    // Cuánto se alejó el usuario respecto del encuadre justo (1 .. ZOOM_MAX)
    function zoomRelativo() {
        return Math.max(1, Math.min(ZOOM_MAX, camera.position.distanceTo(OBJETIVO) / encuadreActual()));
    }

    const controles = new OrbitControls(camera, lienzo);
    controles.target.copy(OBJETIVO);
    controles.enableDamping = true;
    controles.dampingFactor = 0.08;
    controles.enablePan = false;
    controles.rotateSpeed = 0.6;
    controles.zoomSpeed = 0.7;
    controles.minPolarAngle = Math.PI / 2 - ELEVACION_MAX;
    controles.maxPolarAngle = Math.PI / 2 - ELEVACION_MIN;

    let vistaActual = Math.max(0, Math.min(VISTAS.length - 1, Math.floor(Number(view) || 0)));
    let transicion = null;   // { t0, desde, hasta }
    let arrastrando = false;
    posicionOrbital(VISTAS[vistaActual].elevacion, 0, 20, camera.position);
    camera.lookAt(OBJETIVO);

    function setView(i) {
        const indice = ((Math.floor(Number(i) || 0) % VISTAS.length) + VISTAS.length) % VISTAS.length;
        vistaActual = indice;
        // descarta la inercia pendiente del arrastre antes de tomar la posición de partida
        controles.enableDamping = false;
        controles.update();
        controles.enableDamping = true;
        const desde = esfericasActuales();
        const elev = VISTAS[indice].elevacion;
        transicion = {
            t0: reloj(),
            desde,
            hasta: { r: distanciaEncuadre(elev, 0), elev, az: desde.az + diferenciaAngular(desde.az, 0) },
        };
        despertar();
    }

    // Desplaza la imagen para que el tablero quede centrado en la zona útil: con perspectiva, el borde
    // cercano se ve más grande y, sin esto, sobraría espacio arriba.
    function centrarEnPantalla() {
        if (!ancho || !alto) return;
        camaraEncuadre.position.copy(camera.position);
        camaraEncuadre.quaternion.copy(camera.quaternion);
        if (camaraEncuadre.aspect !== camera.aspect) {
            camaraEncuadre.aspect = camera.aspect;
            camaraEncuadre.updateProjectionMatrix();
        }
        const l = limitesEnPantalla();
        const zona = zonaUtil();
        const cx = (l.x0 + l.x1) / 2 - zona.cx, cy = (l.y0 + l.y1) / 2 - zona.cy;
        camera.setViewOffset(ancho, alto, (cx * ancho) / 2, (-cy * alto) / 2, ancho, alto);
    }

    function actualizarCamara(ahora, dt) {
        if (transicion) {
            const u = clamp01((ahora - transicion.t0) / DUR_VISTA);
            const e = easeInOutCubic(u);
            const { desde, hasta } = transicion;
            posicionOrbital(
                desde.elev + (hasta.elev - desde.elev) * e,
                desde.az + (hasta.az - desde.az) * e,
                desde.r + (hasta.r - desde.r) * e,
                camera.position,
            );
            camera.lookAt(OBJETIVO);
            if (u >= 1) transicion = null;
        } else {
            const d = encuadreActual();
            controles.minDistance = d;
            controles.maxDistance = d * ZOOM_MAX;
            controles.update(dt);
        }
        centrarEnPantalla();
    }

    controles.addEventListener('start', () => {
        transicion = null;
        arrastrando = true;
        lienzo.style.cursor = 'grabbing';
    });
    controles.addEventListener('end', () => {
        arrastrando = false;
        lienzo.style.cursor = 'grab';
    });

    // ---------- Tamaño y bucle de dibujo ----------
    let ancho = 0, alto = 0, densidad = 0;
    let primerEncuadre = true;
    let rafId = 0;
    let ultimoCuadro = reloj();
    let eliminada = false;
    let contextoPerdido = false;

    function ajustarTamano() {
        const w = contenedor.clientWidth, h = contenedor.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (w === ancho && h === alto && dpr === densidad) return;
        ancho = w;
        alto = h;
        densidad = dpr;
        if (!w || !h) return;
        // mantiene el zoom relativo del usuario al cambiar la proporción (la primera vez, encuadre justo)
        const zoom = primerEncuadre ? 1
            : Math.max(1, Math.min(ZOOM_MAX, camera.position.distanceTo(OBJETIVO) / encuadreActual()));
        primerEncuadre = false;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const { elev, az } = esfericasActuales();
        posicionOrbital(elev, az, encuadreActual() * zoom, camera.position);
        camera.lookAt(OBJETIVO);
        if (transicion) transicion.hasta.r = distanciaEncuadre(transicion.hasta.elev, transicion.hasta.az);
        if (puedeDibujar()) {
            actualizarCamara(reloj(), 0);
            renderer.render(scene, camera);   // evita un cuadro vacío tras el cambio de tamaño
        }
        despertar();
    }

    function puedeDibujar() {
        return !eliminada && !contextoPerdido && !document.hidden && ancho > 0 && alto > 0;
    }

    function animar(ahora, dt) {
        dados.update(dt);
        animarFichas(ahora);
        animarCrecimientos(ahora);
        animarDestellos(ahora);
        animarMazos(ahora);
    }

    // Las animaciones avanzan por tiempo transcurrido: si el navegador frena o pausa los cuadros,
    // al volver simplemente quedan en su estado final.
    function cuadro() {
        rafId = 0;
        if (eliminada) return;
        const ahora = reloj();
        const dt = Math.max(0, ahora - ultimoCuadro);
        ultimoCuadro = ahora;
        animar(ahora, dt);
        if (!puedeDibujar()) return;   // se reanuda con visibilitychange o ResizeObserver
        actualizarCamara(ahora, dt);
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(cuadro);
    }

    function despertar() {
        if (!rafId && puedeDibujar()) rafId = requestAnimationFrame(cuadro);
    }

    const observador = new ResizeObserver(ajustarTamano);
    observador.observe(contenedor);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) despertar(); }, opcionesEvento);
    window.addEventListener('resize', ajustarTamano, opcionesEvento);   // cambios de devicePixelRatio (zoom del navegador)

    lienzo.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        contextoPerdido = true;
    }, opcionesEvento);
    lienzo.addEventListener('webglcontextrestored', () => {
        contextoPerdido = false;
        crearEntorno();   // el mapa de entorno vivía en la GPU: hay que regenerarlo
        texTablero.needsUpdate = true;
        despertar();
    }, opcionesEvento);

    // Si una fuente web termina de cargar después del primer dibujo, se redibuja el tablero
    document.fonts?.addEventListener?.('loadingdone', () => {
        if (!ultimoEstado || eliminada) return;
        firmaTablero = null;
        setBoard(ultimoEstado);
    }, opcionesEvento);

    // ---------- Clic sobre casillas ----------
    const oyentesClic = new Set();
    let pulsacion = null;

    function casillaEnPantalla(clientX, clientY) {
        const rect = lienzo.getBoundingClientRect();
        if (!rect.width || !rect.height) return -1;
        _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(_ndc, camera);
        const punto = raycaster.ray.intersectPlane(PLANO_TABLERO, _v);
        return punto ? posAt(punto.x, punto.z) : -1;
    }

    lienzo.addEventListener('pointerdown', (e) => {
        pulsacion = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    }, opcionesEvento);
    lienzo.addEventListener('pointerup', (e) => {
        const p = pulsacion;
        pulsacion = null;
        if (!p || p.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) return;   // fue un arrastre de cámara
        const pos = casillaEnPantalla(e.clientX, e.clientY);
        if (pos < 0) return;
        for (const cb of [...oyentesClic]) {
            try { cb(pos); } catch (err) { console.error('Mono3D: error en onCellClick', err); }
        }
    }, opcionesEvento);
    lienzo.addEventListener('pointercancel', () => { pulsacion = null; }, opcionesEvento);
    lienzo.addEventListener('pointermove', (e) => {
        if (arrastrando || e.buttons) return;
        lienzo.style.cursor = oyentesClic.size && casillaEnPantalla(e.clientX, e.clientY) >= 0 ? 'pointer' : 'grab';
    }, opcionesEvento);

    function onCellClick(cb) {
        if (typeof cb !== 'function') return () => {};
        oyentesClic.add(cb);
        return () => oyentesClic.delete(cb);
    }

    function cellScreenPoint(pos) {
        if (!esCasilla(pos)) return null;
        const r = cellRect(pos);
        camera.updateMatrixWorld();
        _v.set(r.cx, 0.05, r.cz).project(camera);
        const rect = lienzo.getBoundingClientRect();
        return {
            x: rect.left + ((_v.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - _v.y) / 2) * rect.height,
        };
    }

    function rollDice(values, animate = false) {
        dados.roll(values, !!animate);
        despertar();
    }

    // ---------- Limpieza ----------
    function dispose() {
        if (eliminada) return;
        eliminada = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        eventos.abort();
        observador.disconnect();
        controles.dispose();

        // Todo lo que hay en la escena (tablero, mesa, fichas, dados, mazos...) más los edificios en reserva
        const recursos = recursosDe(scene);
        for (const obj of Object.values(reservaEdificios).flat()) recursosDe(obj, recursos);
        recursos.geometrias.add(geoCarta).add(geoFrenteCarta).add(geoDestello);
        if (texDestello) recursos.texturas.add(texDestello);
        for (const ficha of fichas.values()) ficha.obj.userData.dispose?.();
        fichas.clear();
        dados.dispose();
        liberarRecursos(recursos);
        scene.environment = null;
        entorno?.dispose();
        entorno = null;
        edificios.clear();
        reservaEdificios.house.length = 0;
        reservaEdificios.hotel.length = 0;
        destellos.length = 0;
        oyentesClic.clear();

        renderer.dispose();
        renderer.forceContextLoss();
        lienzo.remove();
        contenedor.style.position = posicionPrevia;
    }

    ajustarTamano();
    despertar();

    return {
        setBoard,
        setTokens,
        rollDice,
        drawCard,
        flashCell,
        cellScreenPoint,
        onCellClick,
        setView,
        dispose,
        get view() { return vistaActual; },
        get canvas() { return lienzo; },
    };
}
