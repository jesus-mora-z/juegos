// Dados 3D del Monopoly: dos cubos redondeados, blancos con puntos negros (el "1" en rojo).
// createDice(scene) -> { roll(valores, animar), update(dt), group, dispose() }
//  - roll([a, b], true): los dados entran volando desde fuera del tablero, rebotan y quedan quietos
//    en DICE_AREA en ~1,2 s, con la cara del valor hacia arriba (+y) y un giro al azar.
//  - roll([a, b], false): los deja quietos de inmediato mostrando esos valores.
//  - update(dt): avanza la animación según el tiempo transcurrido (segundos), no por cuadros.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DICE_AREA } from './layout.js';

const LADO = 0.42;                 // arista del dado (1 = ancho de una casilla)
const MEDIO = LADO / 2;
const RADIO_BORDE = LADO * 0.14;   // redondeo de aristas y esquinas
const SEPARACION = 0.64;           // distancia entre los centros de los dados ya quietos (sin choques al girar)
const DURACION = 1.2;              // segundos que dura un lanzamiento
const CARA_PX = 256;               // resolución de cada cara en el atlas de puntos

// Valor pintado en cada grupo de caras de BoxGeometry: +x, -x, +y, -y, +z, -z (las opuestas suman 7)
const VALOR_CARA = [3, 4, 1, 6, 2, 5];
const NORMAL_CARA = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
// Puntos de cada valor en una grilla de 3 x 3 (1 = arriba a la izquierda, 9 = abajo a la derecha)
const PUNTOS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

const ARRIBA = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qGiro = new THREE.Quaternion();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const alAzar = (a, b) => a + Math.random() * (b - a);

function valorValido(v) {
    const n = Math.round(Number(v));
    return n >= 1 && n <= 6 ? n : 1;
}

// Atlas de 3 x 2 caras (una por grupo de la geometría). Solo se dibuja la primera vez que se crean dados.
function crearAtlasPuntos() {
    if (typeof document === 'undefined') return null;   // sin DOM (pruebas en Node): dados lisos
    const lienzo = document.createElement('canvas');
    lienzo.width = CARA_PX * 3;
    lienzo.height = CARA_PX * 2;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;

    VALOR_CARA.forEach((valor, i) => {
        const ox = (i % 3) * CARA_PX, oy = Math.floor(i / 3) * CARA_PX;
        // Fondo marfil con un leve oscurecimiento hacia los bordes (da volumen a la cara)
        const fondo = ctx.createRadialGradient(ox + CARA_PX / 2, oy + CARA_PX / 2, CARA_PX * 0.2,
            ox + CARA_PX / 2, oy + CARA_PX / 2, CARA_PX * 0.75);
        fondo.addColorStop(0, '#fbfaf6');
        fondo.addColorStop(1, '#e9e6de');
        ctx.fillStyle = fondo;
        ctx.fillRect(ox, oy, CARA_PX, CARA_PX);

        const esUno = valor === 1;
        const radio = CARA_PX * (esUno ? 0.13 : 0.085);
        for (const celda of PUNTOS[valor]) {
            const col = (celda - 1) % 3, fila = Math.floor((celda - 1) / 3);
            const cx = ox + CARA_PX * (0.25 + col * 0.25);
            const cy = oy + CARA_PX * (0.25 + fila * 0.25);
            // Punto hundido: centro oscuro y un borde algo más claro arriba a la izquierda
            const g = ctx.createRadialGradient(cx + radio * 0.25, cy + radio * 0.25, radio * 0.1, cx, cy, radio);
            g.addColorStop(0, esUno ? '#8f0f1c' : '#050505');
            g.addColorStop(0.8, esUno ? '#c8192c' : '#1c1c1c');
            g.addColorStop(1, esUno ? '#e0485a' : '#4a4a4a');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, radio, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    return textura;
}

// Geometría compartida: una sola malla y un solo material por dado; las UV de cada cara
// se reubican en su casilla del atlas de 3 x 2.
function crearGeometria() {
    const geo = new RoundedBoxGeometry(LADO, LADO, LADO, 4, RADIO_BORDE);
    const uv = geo.attributes.uv;
    for (const grupo of geo.groups) {
        const i = grupo.materialIndex;
        const col = i % 3, fila = Math.floor(i / 3);
        for (let k = grupo.start; k < grupo.start + grupo.count; k++) {
            const u = uv.getX(k), v = uv.getY(k);
            uv.setXY(k, (col + u) / 3, 1 - (fila + 1 - v) / 2);
        }
    }
    uv.needsUpdate = true;
    geo.clearGroups();
    return geo;
}

// Orientación que deja la cara `valor` hacia arriba, girada `yaw` alrededor de Y.
function orientacionFinal(valor, yaw, destino) {
    const i = VALOR_CARA.indexOf(valor);
    _q.setFromUnitVectors(NORMAL_CARA[i], ARRIBA);
    _qGiro.setFromAxisAngle(ARRIBA, yaw);
    return destino.multiplyQuaternions(_qGiro, _q);
}

// Distancia del centro del dado a su punto más bajo con la orientación q (caja redondeada).
function alturaApoyo(q) {
    const e = _m.makeRotationFromQuaternion(q).elements;
    return (MEDIO - RADIO_BORDE) * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9])) + RADIO_BORDE;
}

// Altura sobre la mesa durante el lanzamiento: caída inicial y rebotes cada vez más bajos.
function alturaRebotes(u, r) {
    const { cortes, alturas, y0 } = r;
    if (u < cortes[0]) {
        const s = u / cortes[0];
        return y0 * (1 - s * s);
    }
    for (let k = 0; k < alturas.length; k++) {
        if (u < cortes[k + 1]) {
            const s = (u - cortes[k]) / (cortes[k + 1] - cortes[k]);
            return 4 * alturas[k] * s * (1 - s);
        }
    }
    return 0;
}

// Dos puntos de reposo dentro de DICE_AREA, separados de forma aproximadamente perpendicular al tiro.
function puntosDeReposo(dirTiro) {
    const angTiro = Math.atan2(dirTiro.z, dirTiro.x);
    const ang = angTiro + Math.PI / 2 + alAzar(-0.6, 0.6);
    const radioLibre = Math.max(0, DICE_AREA.r - SEPARACION / 2 - LADO * 0.75);
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radioLibre;
    const cx = DICE_AREA.cx + Math.cos(a) * d, cz = DICE_AREA.cz + Math.sin(a) * d;
    const sx = Math.cos(ang) * SEPARACION / 2, sz = Math.sin(ang) * SEPARACION / 2;
    return [{ x: cx + sx, z: cz + sz }, { x: cx - sx, z: cz - sz }];
}

export function createDice(scene) {
    const group = new THREE.Group();
    group.name = 'dados';

    const textura = crearAtlasPuntos();
    const geometria = crearGeometria();
    const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: textura,
        roughness: 0.32,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.22,
    });

    // Reposo inicial: los dos dados juntos en el centro de la zona, mostrando 5 y 3.
    const reposoInicial = [
        { x: DICE_AREA.cx + SEPARACION / 2, z: DICE_AREA.cz - 0.08, yaw: 0.35 },
        { x: DICE_AREA.cx - SEPARACION / 2, z: DICE_AREA.cz + 0.08, yaw: -0.5 },
    ];
    const dados = [5, 3].map((valor, i) => {
        const malla = new THREE.Mesh(geometria, material);
        malla.name = `dado-${i + 1}`;
        malla.castShadow = true;
        malla.receiveShadow = true;
        group.add(malla);
        return { malla, valor, reposo: { ...reposoInicial[i] }, anim: null, qFinal: new THREE.Quaternion() };
    });

    function dejarQuieto(dado) {
        const { malla, reposo, valor, qFinal } = dado;
        orientacionFinal(valor, reposo.yaw, qFinal);
        malla.quaternion.copy(qFinal);
        malla.position.set(reposo.x, MEDIO, reposo.z);
        dado.anim = null;
    }

    function aplicarPose(dado) {
        const a = dado.anim;
        const u = clamp01(a.t / a.dur);
        const { malla } = dado;
        // Avance horizontal: rápido al comienzo y frenando hasta detenerse
        const avance = 1 - Math.pow(1 - clamp01(u / 0.9), 2.2);
        malla.position.x = a.desde.x + (a.hasta.x - a.desde.x) * avance;
        malla.position.z = a.desde.z + (a.hasta.z - a.desde.z) * avance;
        // Rotación: rueda en la dirección del tiro y se bambolea; ambas se apagan antes del final,
        // así que el dado termina exactamente en su orientación final.
        const resto = Math.pow(1 - clamp01(u / 0.86), 1.8);
        malla.quaternion.setFromAxisAngle(a.ejeRodar, -a.angRodar * resto);
        _q.setFromAxisAngle(a.ejeBamboleo, a.angBamboleo * resto * resto);
        malla.quaternion.multiply(_q).multiply(dado.qFinal);
        malla.position.y = alturaRebotes(u, a.rebotes) + alturaApoyo(malla.quaternion);
    }

    function lanzar(valores) {
        // Tiro desde el costado derecho (fuera del tablero), con algo de variación
        const dir = new THREE.Vector3(1, 0, alAzar(-0.3, 0.45)).normalize();
        const destinos = puntosDeReposo(dir);
        const ejeRodar = new THREE.Vector3().crossVectors(ARRIBA, dir.clone().negate()).normalize();
        dados.forEach((dado, i) => {
            dado.valor = valores[i];
            dado.reposo = { x: destinos[i].x, z: destinos[i].z, yaw: Math.random() * Math.PI * 2 };
            orientacionFinal(dado.valor, dado.reposo.yaw, dado.qFinal);
            const distancia = alAzar(7.6, 8.8);
            const escala = alAzar(0.92, 1.08);
            dado.anim = {
                t: -i * 0.05,                       // el segundo dado sale un instante después
                dur: DURACION * alAzar(0.96, 1.04),
                desde: new THREE.Vector3(destinos[i].x + dir.x * distancia, 0, destinos[i].z + dir.z * distancia),
                hasta: new THREE.Vector3(destinos[i].x, 0, destinos[i].z),
                ejeRodar,
                angRodar: Math.PI * 2 * alAzar(1.6, 2.6),
                ejeBamboleo: dir.clone().applyAxisAngle(ARRIBA, alAzar(-0.5, 0.5)),
                angBamboleo: alAzar(1.2, 2.4) * (Math.random() < 0.5 ? -1 : 1),
                rebotes: {
                    y0: alAzar(2.1, 2.6),
                    cortes: [0.3, 0.56, 0.75, 0.86],
                    alturas: [0.55 * escala, 0.2 * escala, 0.06 * escala],
                },
            };
            aplicarPose(dado);
        });
    }

    function roll(values, animate = false) {
        const valores = [valorValido(values?.[0]), valorValido(values?.[1])];
        if (animate) {
            lanzar(valores);
            return;
        }
        // Sin animación: si ya van a caer en esos valores, se deja terminar el lanzamiento en curso
        const mismos = dados.every((d, i) => d.valor === valores[i]);
        if (mismos && dados.some(d => d.anim)) return;
        dados.forEach((dado, i) => {
            if (dado.valor === valores[i] && !dado.anim) return;
            dado.valor = valores[i];
            dejarQuieto(dado);
        });
    }

    function update(dt) {
        if (!(dt > 0)) return;
        for (const dado of dados) {
            if (!dado.anim) continue;
            dado.anim.t += dt;
            if (dado.anim.t >= dado.anim.dur) dejarQuieto(dado);
            else if (dado.anim.t > 0) aplicarPose(dado);
        }
    }

    function dispose() {
        group.removeFromParent();
        geometria.dispose();
        material.dispose();
        textura?.dispose();
    }

    dados.forEach(dejarQuieto);
    scene?.add(group);

    return {
        roll,
        update,
        group,
        dispose,
        get rolling() { return dados.some(d => d.anim); },
        get values() { return dados.map(d => d.valor); },
    };
}
