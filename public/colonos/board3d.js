// Isla 3D de "Colonos de la Isla" (Three.js). Las coordenadas del servidor (x, y) se usan como (x, z)
// en el mundo; cada hexágono mide 1 de radio y su cara superior queda en y = TOP.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TOP = 0.22;
const TILE_COLORS = { wood: '#2f7a2c', brick: '#b8502a', sheep: '#86c24a', wheat: '#e2ad1e', ore: '#7d8894', desert: '#d9bd7c' };
const PORT_ICONS = { any: '❓', wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' };

// Números pseudoaleatorios estables por hexágono (la decoración no cambia entre redibujos)
function seeded(seed) {
    let s = seed * 9301 + 49297;
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

export function createColonosBoard(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#123a55');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 10.5, 9.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 22;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.2;

    scene.add(new THREE.HemisphereLight('#dff1ff', '#35506a', 0.55));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.0);
    sun.position.set(6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // Mar (dos tonos) y marco de arena alrededor de la isla
    const deep = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#15496b', roughness: 0.6 }));
    deep.rotation.x = -Math.PI / 2;
    deep.position.y = -0.3;
    deep.receiveShadow = true;
    scene.add(deep);
    // Mar y marco macizo de madera (anillo hexagonal con borde plano). Su tamaño depende de la isla:
    // la del juego base mide ~7.2 de radio y la de la expansión 5-6 jugadores es más grande.
    const hexPath = (path, r) => {
        for (let i = 0; i <= 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            i === 0 ? path.moveTo(r * Math.cos(a), r * Math.sin(a)) : path.lineTo(r * Math.cos(a), r * Math.sin(a));
        }
        return path;
    };
    const seaMat = new THREE.MeshStandardMaterial({ color: '#2f86b8', roughness: 0.25, metalness: 0.1 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.6 });
    let sea = null, frame = null;
    let islandRadius = 7.2;
    function buildBase(R) {
        for (const m of [sea, frame]) if (m) { scene.remove(m); m.geometry.dispose(); }
        islandRadius = R;
        sea = new THREE.Mesh(new THREE.CircleGeometry(R, 6), seaMat);
        sea.rotation.x = -Math.PI / 2;
        sea.position.y = -0.02;
        sea.receiveShadow = true;
        scene.add(sea);
        const ring = hexPath(new THREE.Shape(), R + 0.75);
        ring.holes.push(hexPath(new THREE.Path(), R));
        frame = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }), frameMat);
        frame.rotation.x = -Math.PI / 2;
        frame.position.y = -0.22;
        frame.castShadow = true;
        frame.receiveShadow = true;
        scene.add(frame);
        const s = R + 1;
        Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
        sun.shadow.camera.updateProjectionMatrix();
        controls.maxDistance = 22 * R / 7.2;
    }
    buildBase(7.2);

    const tiles = new THREE.Group(), pieces = new THREE.Group(), markers = new THREE.Group(), ports = new THREE.Group();
    scene.add(tiles, pieces, markers, ports);

    // ---------- Materiales y geometrías compartidas ----------
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
    const colorMats = new Map();
    const playerMat = color => {
        if (!colorMats.has(color)) colorMats.set(color, mat(color, { roughness: 0.4 }));
        return colorMats.get(color);
    };
    const G = {
        tile: new THREE.CylinderGeometry(0.96, 0.96, TOP, 6),
        tileBase: new THREE.CylinderGeometry(1.0, 1.0, TOP * 0.8, 6),
        cone: new THREE.ConeGeometry(0.11, 0.34, 7),
        trunk: new THREE.CylinderGeometry(0.025, 0.03, 0.1, 5),
        rock: new THREE.DodecahedronGeometry(0.17, 0),
        wheat: new THREE.CylinderGeometry(0.035, 0.05, 0.2, 5),
        sheepBody: new THREE.SphereGeometry(0.085, 10, 8),
        sheepHead: new THREE.SphereGeometry(0.04, 8, 6),
        brick: new THREE.BoxGeometry(0.13, 0.06, 0.07),
        cactus: new THREE.CylinderGeometry(0.04, 0.045, 0.24, 8),
        token: new THREE.CylinderGeometry(0.34, 0.34, 0.05, 32),
        road: new THREE.BoxGeometry(0.58, 0.08, 0.12),
        houseBody: new THREE.BoxGeometry(0.2, 0.15, 0.2),
        cityBody: new THREE.BoxGeometry(0.36, 0.15, 0.22),
        tower: new THREE.BoxGeometry(0.17, 0.32, 0.22),
        roof: (() => {
            const s = new THREE.Shape();
            s.moveTo(-0.12, 0); s.lineTo(0.12, 0); s.lineTo(0, 0.12); s.closePath();
            const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false });
            g.translate(0, 0, -0.11);
            return g;
        })(),
        vertexMarker: new THREE.SphereGeometry(0.11, 16, 12),
        edgeMarker: new THREE.BoxGeometry(0.5, 0.06, 0.14),
        hexMarker: new THREE.RingGeometry(0.5, 0.78, 6),
        dock: new THREE.BoxGeometry(0.5, 0.05, 0.22),
        plank: new THREE.BoxGeometry(0.06, 0.04, 0.5),
    };
    const M = {
        leaf: mat('#1f6b2a'), trunk: mat('#6b4423'), rock: mat('#6f7a86', { roughness: 0.9 }),
        snow: mat('#f4f7fa'), wheat: mat('#d9a520'), wool: mat('#fbfbf7', { roughness: 0.95 }), head: mat('#2b2b2b'),
        brick: mat('#9c3d1d'), cactus: mat('#4a8a3a'), tokenSide: mat('#e9dcb8'), dock: mat('#8b5a2b'),
        marker: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe066', emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }),
        hexMarker: new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
        robber: new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.35, metalness: 0.3 }),
    };
    const tileMats = Object.fromEntries(Object.entries(TILE_COLORS).map(([k, c]) => [k, mat(c, { roughness: 0.8 })]));
    const tileBaseMat = mat('#d9c38d', { roughness: 0.9 });

    const add = (group, geo, m, x, y, z, opts = {}) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        if (opts.rotY) mesh.rotation.y = opts.rotY;
        if (opts.scale) mesh.scale.setScalar(opts.scale);
        mesh.castShadow = opts.cast !== false;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    };

    // ---------- Hexágonos con decoración según el recurso ----------
    function decorate(group, hex) {
        const rand = seeded(hex.id + 1);
        const spots = n => Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2 + rand() * 0.6, r = 0.52 + rand() * 0.2;
            return [hex.x + Math.cos(a) * r, hex.y + Math.sin(a) * r];
        });
        switch (hex.resource) {
            case 'wood':
                for (const [x, z] of spots(7)) {
                    const s = 0.8 + rand() * 0.5;
                    add(group, G.trunk, M.trunk, x, TOP + 0.05 * s, z, { scale: s });
                    add(group, G.cone, M.leaf, x, TOP + 0.26 * s, z, { scale: s });
                }
                break;
            case 'ore':
                for (const [x, z] of spots(4)) {
                    const s = 0.9 + rand() * 0.7;
                    const r = add(group, G.rock, M.rock, x, TOP + 0.1 * s, z, { scale: s, rotY: rand() * 6 });
                    r.scale.y *= 1.4;
                    if (s > 1.3) add(group, G.rock, M.snow, x, TOP + 0.26 * s, z, { scale: s * 0.45 });
                }
                break;
            case 'wheat':
                for (const [x, z] of spots(10)) add(group, G.wheat, M.wheat, x, TOP + 0.1, z, { scale: 0.8 + rand() * 0.4 });
                break;
            case 'sheep':
                for (const [x, z] of spots(4)) {
                    const yaw = rand() * 6;
                    add(group, G.sheepBody, M.wool, x, TOP + 0.08, z, { rotY: yaw });
                    add(group, G.sheepHead, M.head, x + Math.cos(yaw) * 0.09, TOP + 0.11, z - Math.sin(yaw) * 0.09);
                }
                break;
            case 'brick':
                for (const [x, z] of spots(4)) {
                    const yaw = rand() * 6;
                    for (let k = 0; k < 3; k++) add(group, G.brick, M.brick, x, TOP + 0.03 + k * 0.06, z, { rotY: yaw + k * 0.3 });
                }
                break;
            case 'desert':
                for (const [x, z] of spots(3)) add(group, G.cactus, M.cactus, x, TOP + 0.12, z, { scale: 0.8 + rand() * 0.6 });
                break;
        }
    }

    const tokenMats = new Map();
    function tokenMaterial(n) {
        if (!tokenMats.has(n)) {
            const hot = n === 6 || n === 8;
            const map = canvasTexture(128, 128, (ctx, w) => {
                ctx.fillStyle = '#f3e7c6';
                ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = hot ? '#c62828' : '#222';
                ctx.font = `bold ${hot ? 70 : 64}px Georgia, serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String(n), w / 2, w / 2 - 8);
                const pips = 6 - Math.abs(7 - n);
                for (let i = 0; i < pips; i++) {
                    ctx.beginPath();
                    ctx.arc(w / 2 + (i - (pips - 1) / 2) * 11, w / 2 + 34, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
            tokenMats.set(n, [M.tokenSide, new THREE.MeshStandardMaterial({ map, roughness: 0.6 }), M.tokenSide]);
        }
        return tokenMats.get(n);
    }

    function portLabel(type) {
        const map = canvasTexture(160, 96, (ctx, w, h) => {
            ctx.fillStyle = 'rgba(255, 250, 235, 0.95)';
            ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.roundRect(4, 4, w - 8, h - 8, 18); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#3a2412';
            ctx.font = 'bold 40px Arial Black, Arial, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(type === 'any' ? '3:1' : '2:1', w * 0.36, h / 2);
            ctx.font = '38px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(PORT_ICONS[type], w * 0.76, h / 2);
        });
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
        sprite.scale.set(0.8, 0.48, 1);
        return sprite;
    }

    let boardKey = null;
    const tileMeshes = new Map();
    let geometry = null;
    function buildBoard(state) {
        for (const g of [tiles, ports]) g.clear();
        tileMeshes.clear();
        geometry = state.geometry;
        const maxX = Math.max(...geometry.vertices.map(v => Math.abs(v.x)));
        const maxY = Math.max(...geometry.vertices.map(v => Math.abs(v.y)));
        const R = Math.max(maxX, maxY / 0.866) + 2.6;
        if (Math.abs(R - islandRadius) > 0.01) { buildBase(R); resize(); }
        for (const hex of state.board.hexes) {
            add(tiles, G.tileBase, tileBaseMat, hex.x, TOP * 0.4, hex.y);
            const top = add(tiles, G.tile, tileMats[hex.resource].clone(), hex.x, TOP / 2 + 0.02, hex.y);
            top.userData.hex = hex.id;
            tileMeshes.set(hex.id, top);
            decorate(tiles, hex);
            if (hex.number) add(tiles, G.token, tokenMaterial(hex.number), hex.x, TOP + 0.045, hex.y);
        }
        for (const port of state.board.ports) {
            const a = geometry.vertices[port.vertices[0]], b = geometry.vertices[port.vertices[1]];
            const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
            const len = Math.hypot(mx, mz);
            const ox = mx / len, oz = mz / len;
            const px = mx + ox * 0.5, pz = mz + oz * 0.5;
            add(ports, G.dock, M.dock, px, 0.03, pz, { rotY: -Math.atan2(b.y - a.y, b.x - a.x) });
            for (const v of [a, b]) {
                const plank = add(ports, G.plank, M.dock, (v.x + px) / 2, 0.04, (v.y + pz) / 2);
                plank.rotation.y = Math.atan2(px - v.x, pz - v.y);
            }
            const label = portLabel(port.type);
            label.position.set(px + ox * 0.25, 0.55, pz + oz * 0.25);
            ports.add(label);
        }
    }

    // ---------- Piezas: caminos, pueblos, ciudades y ladrón ----------
    const robber = new THREE.Group();
    {
        const pts = [[0, 0], [0.16, 0], [0.15, 0.05], [0.09, 0.12], [0.12, 0.3], [0.08, 0.4], [0.1, 0.46], [0.07, 0.53], [0, 0.56]]
            .map(([x, y]) => new THREE.Vector2(x, y));
        const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), M.robber);
        body.castShadow = true;
        robber.add(body);
        robber.visible = false;
        scene.add(robber);
    }
    const robberTarget = new THREE.Vector3();

    function vpos(v) { const p = geometry.vertices[v]; return [p.x, p.y]; }
    function buildPieces(state) {
        pieces.clear();
        for (const e in state.roads) {
            const edge = geometry.edges[e];
            const [ax, az] = vpos(edge.a), [bx, bz] = vpos(edge.b);
            add(pieces, G.road, playerMat(state.roads[e].color), (ax + bx) / 2, TOP + 0.04, (az + bz) / 2, { rotY: -Math.atan2(bz - az, bx - ax) });
        }
        for (const v in state.buildings) {
            const b = state.buildings[v];
            const [x, z] = vpos(v);
            const m = playerMat(b.color);
            const yaw = -Math.atan2(z, x) + Math.PI / 2;
            if (b.type === 'city') {
                const g = new THREE.Group();
                add(g, G.cityBody, m, 0.04, 0.075, 0);
                add(g, G.tower, m, -0.1, 0.16, 0);
                add(g, G.roof, m, -0.1, 0.32, 0, { scale: 0.75 });
                g.position.set(x, TOP, z);
                g.rotation.y = yaw;
                pieces.add(g);
            } else {
                const g = new THREE.Group();
                add(g, G.houseBody, m, 0, 0.075, 0);
                add(g, G.roof, m, 0, 0.15, 0);
                g.position.set(x, TOP, z);
                g.rotation.y = yaw;
                pieces.add(g);
            }
        }
        const hex = state.board.hexes[state.robber];
        if (hex) {
            robberTarget.set(hex.x + 0.32, TOP, hex.y + 0.12);
            if (!robber.visible) robber.position.copy(robberTarget);
            robber.visible = true;
        }
    }

    // ---------- Lugares elegibles (marcadores que se pueden clickear) ----------
    function setMarkers(kind, ids) {
        markers.clear();
        if (!kind || !geometry) return;
        for (const id of ids) {
            let mesh;
            if (kind === 'vertex') {
                const [x, z] = vpos(id);
                mesh = add(markers, G.vertexMarker, M.marker, x, TOP + 0.12, z, { cast: false });
            } else if (kind === 'edge') {
                const edge = geometry.edges[id];
                const [ax, az] = vpos(edge.a), [bx, bz] = vpos(edge.b);
                mesh = add(markers, G.edgeMarker, M.marker, (ax + bx) / 2, TOP + 0.05, (az + bz) / 2, { rotY: -Math.atan2(bz - az, bx - ax), cast: false });
            } else if (kind === 'hex') {
                const hex = lastState.board.hexes[id];
                mesh = add(markers, G.hexMarker, M.hexMarker, hex.x, TOP + 0.03, hex.y, { cast: false });
                mesh.rotation.x = -Math.PI / 2;
                mesh.rotation.z = Math.PI / 6;
            }
            mesh.userData.pick = { kind, id };
        }
    }

    // ---------- Selección con el mouse (se ignoran los arrastres de cámara) ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
    const pickListeners = new Set();
    renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
        if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
        const r = renderer.domElement.getBoundingClientRect();
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(markers.children, false)[0];
        if (hit) pickListeners.forEach(cb => cb(hit.object.userData.pick));
    });
    renderer.domElement.addEventListener('pointermove', e => {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        renderer.domElement.style.cursor = raycaster.intersectObjects(markers.children, false).length ? 'pointer' : 'grab';
    });

    // Destello de los hexágonos que producen con la última tirada
    let flash = null;
    function flashNumber(state) {
        const n = state.dice[0] + state.dice[1];
        flash = { t0: performance.now(), hexes: state.board.hexes.filter(h => h.number === n && h.id !== state.robber).map(h => h.id) };
    }

    function resize() {
        const w = container.clientWidth, h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // En pantallas angostas la cámara se aleja para que entre la isla completa
        const scale = Math.pow(islandRadius / 7.2, 1.5);
        camera.position.setLength(scale * Math.max(13.5, 13.5 * 1.35 / camera.aspect));
        camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let running = true;
    function loop(t) {
        if (!running) return;
        requestAnimationFrame(loop);
        if (document.hidden || !container.clientWidth) return;
        controls.update();
        const pulse = 0.7 + Math.sin(t / 220) * 0.3;
        M.marker.emissiveIntensity = 0.8 + pulse;
        M.hexMarker.opacity = 0.35 + pulse * 0.4;
        markers.children.forEach(m => { if (m.userData.pick?.kind === 'vertex') m.scale.setScalar(0.85 + pulse * 0.3); });
        if (robber.visible) robber.position.lerp(robberTarget, 0.12);
        if (flash) {
            const u = (t - flash.t0) / 1800;
            for (const id of flash.hexes) {
                const m = tileMeshes.get(id)?.material;
                if (m) { m.emissive.set('#fff3b0'); m.emissiveIntensity = u < 1 ? Math.sin(u * Math.PI) * 0.8 : 0; }
            }
            if (u >= 1) flash = null;
        }
        renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);

    let lastState = null;
    let lastRoll = null;
    return {
        update(state) {
            if (!state.board) return;
            const key = JSON.stringify(state.board.hexes.map(h => [h.resource, h.number]));
            if (key !== boardKey) { boardKey = key; buildBoard(state); }
            lastState = state;
            buildPieces(state);
            if (lastRoll !== null && state.rollId !== lastRoll) flashNumber(state);
            lastRoll = state.rollId;
        },
        setMarkers,
        onPick(cb) { pickListeners.add(cb); },
        dispose() {
            running = false;
            ro.disconnect();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}
