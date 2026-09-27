// Casas y hoteles 3D del Monopoly (las clásicas piezas de plástico verde y rojo) y su ubicación sobre la banda
// de color de cada calle. Origen en el centro de la base, apoyados en y = 0 y con el frente hacia +z (la escena
// los gira con el yaw de la casilla para que miren al jugador de ese lado).
// Cada pieza es una sola malla: las geometrías y el material (colores por vértice) se comparten entre todas.

import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cellRect } from './layout.js';

// Medidas aproximadas (ancho x, fondo z, alto y)
export const HOUSE_SIZE = { w: 0.2, d: 0.2, h: 0.22 };
export const HOTEL_SIZE = { w: 0.42, d: 0.23, h: 0.3 };

const COLORS = {
    house: 0x1f9d4c, houseRoof: 0x17803d, houseDoor: 0x0d4f26,
    hotel: 0xd7263d, hotelRoof: 0xa91d30, hotelDoor: 0x6e1220,
    window: 0xf3edc8, sign: 0xf2c14e,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

// Pinta una pieza con un color por vértice (queda sin índice, con normales "con pliegue" y lista para fusionar)
function paint(geo, color, { p = [0, 0, 0], r = [0, 0, 0] } = {}) {
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    geo.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q, _one));
    // toCreasedNormals agrupa vértices con precisión de 0.01: se escala x100 mientras se calculan las normales
    geo.scale(100, 100, 100);
    const out = toCreasedNormals(geo, 0.9);
    if (out !== geo) geo.dispose();
    out.scale(0.01, 0.01, 0.01);
    for (const name of Object.keys(out.attributes)) {
        if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
    }
    out.clearGroups();
    const c = new THREE.Color(color);
    const colors = new Float32Array(out.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return out;
}

// Une las piezas en una sola geometría (sin índice: con tan pocos vértices no vale la pena indexar)
function fuse(parts) {
    const out = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
}

// Prisma triangular (techo a dos aguas): triángulo de perfil (x del dibujo = eje del frontón) extruido con bisel
function roofPrism(halfSpan, y0, y1, length, bevel = 0.008) {
    const tri = new THREE.Shape();
    tri.moveTo(-halfSpan, y0);
    tri.lineTo(halfSpan, y0);
    tri.lineTo(0, y1);
    tri.closePath();
    const depth = length - 2 * bevel;
    const geo = new THREE.ExtrudeGeometry(tri, {
        depth, curveSegments: 1,
        bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
}

// Casa: paredes, techo a dos aguas con el frontón hacia el frente (+z), chimenea, puerta y ventanas
function houseGeometry() {
    const parts = [];
    const add = (geo, color, t) => parts.push(paint(geo, color, t));
    add(new RoundedBoxGeometry(0.18, 0.135, 0.18, 2, 0.012), COLORS.house, { p: [0, 0.0675, 0] });
    add(roofPrism(0.1, 0.128, 0.22, 0.2), COLORS.houseRoof);
    add(new RoundedBoxGeometry(0.03, 0.06, 0.03, 1, 0.004), COLORS.houseRoof, { p: [0.048, 0.19, -0.04] });
    add(new THREE.BoxGeometry(0.042, 0.068, 0.006), COLORS.houseDoor, { p: [0, 0.034, 0.0905] });
    for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.03, 0.03, 0.006), COLORS.window, { p: [sx * 0.052, 0.085, 0.0905] });
        add(new THREE.BoxGeometry(0.006, 0.032, 0.038), COLORS.window, { p: [sx * 0.0905, 0.08, 0] });
    }
    return fuse(parts);
}

// Hotel: bloque largo con techo a dos aguas a lo largo (eje x), puerta, dos filas de ventanas y un letrero dorado
function hotelGeometry() {
    const parts = [];
    const add = (geo, color, t) => parts.push(paint(geo, color, t));
    add(new RoundedBoxGeometry(0.4, 0.19, 0.2, 2, 0.014), COLORS.hotel, { p: [0, 0.095, 0] });
    add(roofPrism(0.113, 0.182, 0.3, 0.42, 0.01), COLORS.hotelRoof, { r: [0, Math.PI / 2, 0] });
    add(new THREE.BoxGeometry(0.05, 0.075, 0.006), COLORS.hotelDoor, { p: [0, 0.0375, 0.1005] });
    add(new RoundedBoxGeometry(0.11, 0.032, 0.008, 1, 0.003), COLORS.sign, { p: [0, 0.152, 0.101] });
    for (const x of [-0.155, -0.09, 0.09, 0.155]) {
        add(new THREE.BoxGeometry(0.03, 0.034, 0.006), COLORS.window, { p: [x, 0.075, 0.1005] });
        add(new THREE.BoxGeometry(0.03, 0.034, 0.006), COLORS.window, { p: [x, 0.145, 0.1005] });
        add(new THREE.BoxGeometry(0.03, 0.034, 0.006), COLORS.window, { p: [x, 0.11, -0.1005] });
    }
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.006, 0.034, 0.03), COLORS.window, { p: [sx * 0.2005, 0.11, 0] });
    return fuse(parts);
}

let GEOS = null;
let MATERIAL = null;

function shared() {
    if (!GEOS) {
        GEOS = { house: houseGeometry(), hotel: hotelGeometry() };
        MATERIAL = new THREE.MeshStandardMaterial({ name: 'plastico-edificios', vertexColors: true, roughness: 0.34, metalness: 0 });
        MATERIAL.userData.shared = true;
    }
    return { geos: GEOS, material: MATERIAL };
}

function building(kind, name) {
    const { geos, material } = shared();
    const group = new THREE.Group();
    group.name = name;
    const mesh = new THREE.Mesh(geos[kind], material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.userData.kind = kind;
    return group;
}

export function createHouse() {
    return building('house', 'casa');
}

export function createHotel() {
    return building('hotel', 'hotel');
}

// Ubicación de las construcciones de una casilla: [{ kind: 'house' | 'hotel', x, z, yaw }].
// Las casas (1..4) se reparten a lo largo de la banda de color (eje paralelo al borde exterior), centradas en su
// fondo y ordenadas de izquierda a derecha según el jugador de ese lado; con 5 va un único hotel al centro.
export function buildingPlacements(pos, houses) {
    const p = Number(pos);
    const n = Math.max(0, Math.min(5, Math.floor(Number(houses) || 0)));
    if (!n || !Number.isInteger(p) || p < 0 || p > 39) return [];
    const r = cellRect(p);
    const b = r.band;
    if (!b) return [];
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const yaw = r.yaw;
    if (n === 5) return [{ kind: 'hotel', x: cx, z: cz, yaw }];

    // Dirección "derecha" de una pieza girada con este yaw (paralela al borde exterior de la casilla)
    const ax = Math.round(Math.cos(yaw)), az = Math.round(-Math.sin(yaw));
    const len = ax !== 0 ? b.x1 - b.x0 : b.z1 - b.z0;
    const step = len / 4;
    return Array.from({ length: n }, (_, i) => {
        const o = (i - (n - 1) / 2) * step;
        return { kind: 'house', x: cx + ax * o, z: cz + az * o, yaw };
    });
}
