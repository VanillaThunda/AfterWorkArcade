/**
 * Gemeinsamer Baustein für Spiele: Richtungs-Steuerung per Tastatur und Touch.
 *
 * Verwendung in games/<id>/public/client.js:
 *
 *   import { createDirectionalControls } from "/js/game-kit/controls.js";
 *   const controls = createDirectionalControls({
 *       onDirection: dir => ctx.sendAction({ type: "turn", dir }),  // "up" | "down" | "left" | "right"
 *       isActive: () => state?.phase === "running",
 *       swipeTarget: canvas                                         // optional: Wischen
 *   });
 *   container.append(controls.element);   // Steuerkreuz (nur auf Touch-Geräten sichtbar)
 *   …
 *   controls.destroy();                   // in destroy() des Spiels
 *
 * Tastatur: Pfeiltasten und WASD. Ignoriert werden Eingaben in Textfeldern
 * (z. B. Chat), bei offenem Dialog, mit Strg/Alt/Meta und gedrückt gehaltene
 * Tasten. Behandelte Tasten verhindern das Scrollen der Seite.
 */

const KEY_DIRECTIONS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
};

const STYLE_ID = "awa-game-kit-controls";
const STYLES = `
.gk-dpad {
    display: none;
    grid-template: repeat(3, 56px) / repeat(3, 56px);
    gap: 6px;
    justify-content: center;
    margin: 10px auto 0;
    touch-action: none;
    user-select: none;
}
@media (pointer: coarse) {
    .gk-dpad { display: grid; }
}
.gk-dpad button {
    padding: 0;
    font-size: 24px;
    border-radius: 12px;
    touch-action: none;
}
.gk-dpad [data-dir="up"] { grid-area: 1 / 2; }
.gk-dpad [data-dir="left"] { grid-area: 2 / 1; }
.gk-dpad [data-dir="right"] { grid-area: 2 / 3; }
.gk-dpad [data-dir="down"] { grid-area: 3 / 2; }
`;

/** Stylesheet des Bausteins einmalig einfügen. */
function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
}

/** Liegt der Fokus in einem Eingabeelement (dann gehören die Tasten dorthin)? */
function isTyping(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/**
 * @param {object} options
 * @param {(dir: "up"|"down"|"left"|"right") => void} options.onDirection
 * @param {() => boolean} [options.isActive]   nur reagieren, wenn true
 * @param {HTMLElement} [options.swipeTarget]  Element für Wischgesten
 * @returns {{ element: HTMLElement, destroy: () => void }}
 */
export function createDirectionalControls({ onDirection, isActive = () => true, swipeTarget = null }) {
    ensureStyles();

    function emit(dir) {
        if (isActive()) onDirection(dir);
    }

    // --- Tastatur -------------------------------------------------------------
    function onKeyDown(event) {
        const dir = KEY_DIRECTIONS[event.key];
        if (!dir || event.ctrlKey || event.altKey || event.metaKey) return;
        if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
        if (!isActive()) return;
        event.preventDefault(); // Pfeiltasten scrollen sonst die Seite
        if (event.repeat) return;
        onDirection(dir);
    }
    document.addEventListener("keydown", onKeyDown);

    // --- Steuerkreuz ------------------------------------------------------------
    const element = document.createElement("div");
    element.className = "gk-dpad";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Steuerung");
    for (const [dir, symbol, label] of [["up", "▲", "hoch"], ["left", "◀", "links"], ["right", "▶", "rechts"], ["down", "▼", "runter"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.dir = dir;
        button.textContent = symbol;
        button.setAttribute("aria-label", label);
        button.addEventListener("pointerdown", event => {
            event.preventDefault();
            emit(dir);
        });
        element.append(button);
    }

    // --- Wischen ------------------------------------------------------------------
    let swipeStart = null;
    const onPointerDown = event => {
        if (event.pointerType === "mouse") return;
        swipeStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = event => {
        if (!swipeStart) return;
        const dx = event.clientX - swipeStart.x;
        const dy = event.clientY - swipeStart.y;
        swipeStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; // zu kurz
        emit(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    };
    if (swipeTarget) {
        swipeTarget.style.touchAction = "none";
        swipeTarget.addEventListener("pointerdown", onPointerDown);
        swipeTarget.addEventListener("pointerup", onPointerUp);
    }

    return {
        element,
        destroy() {
            document.removeEventListener("keydown", onKeyDown);
            if (swipeTarget) {
                swipeTarget.removeEventListener("pointerdown", onPointerDown);
                swipeTarget.removeEventListener("pointerup", onPointerUp);
            }
            element.remove();
        }
    };
}
