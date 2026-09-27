// Punto de entrada del tablero 3D del Monopoly (WebGL con Three.js).
// Si el navegador soporta WebGL 2, publica window.Mono3D y dispara el evento 'mono3d-ready' en window.
// Si no, no hace nada: client.js sigue usando el tablero HTML de respaldo.
//
// Para forzar el tablero HTML: localStorage 'mono.3d' = 'off'.
// Para usar el 3D aunque el navegador avise que la GPU es lenta (render por software): 'mono.3d' = 'on'.
import { createMonoScene } from './scene.js';

let escena = null;
let contenedorActual = null;
let vistaPendiente = 0;
const oyentesClic = new Set();

// Ejecuta una llamada a la escena sin dejar que un error rompa el flujo de client.js.
function seguro(nombre, fn, porDefecto) {
    if (!escena) return porDefecto;
    try {
        return fn(escena);
    } catch (err) {
        console.error(`Mono3D.${nombre}:`, err);
        return porDefecto;
    }
}

function avisarClic(pos) {
    for (const cb of [...oyentesClic]) {
        try { cb(pos); } catch (err) { console.error('Mono3D: error en onCellClick', err); }
    }
}

export const Mono3D = {
    // Crea el lienzo WebGL dentro del contenedor. Devuelve false si no se pudo (queda el tablero HTML).
    // opciones.insets: píxeles tapados por la interfaz HTML ({ top, right, bottom, left })
    init(containerEl, opciones = {}) {
        if (!containerEl) return false;
        if (escena && contenedorActual === containerEl) return true;
        Mono3D.dispose();
        try {
            escena = createMonoScene(containerEl, { view: vistaPendiente, insets: opciones.insets || null });
            contenedorActual = containerEl;
            escena.onCellClick(avisarClic);
            return true;
        } catch (err) {
            console.warn('Mono3D: no se pudo iniciar el tablero 3D; se usa el tablero HTML.', err);
            escena = null;
            contenedorActual = null;
            return false;
        }
    },

    // Redibuja la textura del tablero si cambió su firma y sincroniza casas/hoteles.
    setBoard(state) { seguro('setBoard', e => e.setBoard(state)); },

    // list = [{ pid, kind, color, pos, jailed, mine, active }]; opciones = { movingPid, effect: 'hop'|'jump' }
    setTokens(list, opciones) { seguro('setTokens', e => e.setTokens(list, opciones)); },

    rollDice(values, animate = false) { seguro('rollDice', e => e.rollDice(values, animate)); },

    // Levanta y da vuelta la carta de arriba del mazo: 'chance' (Suerte) o 'chest' (Arca Comunal).
    drawCard(deck) { seguro('drawCard', e => e.drawCard(deck)); },

    flashCell(pos, colorHex) { seguro('flashCell', e => e.flashCell(pos, colorHex)); },

    // Centro de la casilla en píxeles de la ventana (clientX/clientY), o null.
    cellScreenPoint(pos) { return seguro('cellScreenPoint', e => e.cellScreenPoint(pos), null); },

    // Registra un oyente de clic sobre casillas (se conserva entre init/dispose). Devuelve la baja.
    onCellClick(cb) {
        if (typeof cb !== 'function') return () => {};
        oyentesClic.add(cb);
        return () => oyentesClic.delete(cb);
    },

    // 0 = 3D, 1 = baja, 2 = superior. Antes de init solo se recuerda para usarla al crear la escena.
    setView(i) {
        vistaPendiente = ((Math.floor(Number(i) || 0) % 3) + 3) % 3;
        seguro('setView', e => e.setView(vistaPendiente));
    },

    dispose() {
        seguro('dispose', e => e.dispose());
        escena = null;
        contenedorActual = null;
    },

    get active() { return escena !== null; },
    get view() { return escena ? escena.view : vistaPendiente; },
};

function preferencia() {
    try { return localStorage.getItem('mono.3d'); } catch { return null; }
}

// WebGL 2 real (Three.js r186 ya no soporta WebGL 1). Salvo que se fuerce, se descarta el render
// por software, que haría el tablero lento: en ese caso conviene más el tablero HTML.
function hayWebGL() {
    try {
        const lienzo = document.createElement('canvas');
        const gl = lienzo.getContext('webgl2', { failIfMajorPerformanceCaveat: preferencia() !== 'on' });
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && preferencia() !== 'off' && hayWebGL()) {
    window.Mono3D = Mono3D;
    window.dispatchEvent(new CustomEvent('mono3d-ready', { detail: Mono3D }));
}

export default Mono3D;
