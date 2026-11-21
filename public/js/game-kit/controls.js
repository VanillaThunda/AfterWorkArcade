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
 * Für Spiele mit „Taste halten“ (z. B. Bomben-Labyrinth) gibt es zusätzlich:
 *
 *   onRelease: dir => …,                  // Taste/Knopf losgelassen (auch bei Fokusverlust)
 *   actionButton: {                       // Aktionstaste + Touch-Knopf neben dem Steuerkreuz
 *       label: "💣", ariaLabel: "Bombe legen",
 *       keys: [" ", "Enter"],             // Standard: Leertaste und Enter
 *       onPress: () => ctx.sendAction({ type: "bomb" })
 *   }
 *
 * Tastatur: Pfeiltasten und WASD. Ignoriert werden Eingaben in Textfeldern
 * (z. B. Chat), bei offenem Dialog, mit Strg/Alt/Meta und gedrückt gehaltene
 * Tasten (Wiederholung). Behandelte Tasten verhindern das Scrollen der Seite.
 */

const KEY_DIRECTIONS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
};

const STYLE_ID = "awa-game-kit-controls";
const STYLES = `
.gk-pad {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 18px;
    margin: 10px auto 0;
    touch-action: none;
    user-select: none;
}
@media (pointer: coarse) {
    .gk-pad { display: flex; }
}
.gk-dpad {
    display: grid;
    grid-template: repeat(3, 56px) / repeat(3, 56px);
    gap: 6px;
    touch-action: none;
}
.gk-pad button {
    padding: 0;
    font-size: 24px;
    border-radius: 12px;
    touch-action: none;
}
.gk-dpad [data-dir="up"] { grid-area: 1 / 2; }
.gk-dpad [data-dir="left"] { grid-area: 2 / 1; }
.gk-dpad [data-dir="right"] { grid-area: 2 / 3; }
.gk-dpad [data-dir="down"] { grid-area: 3 / 2; }
.gk-pad .gk-action {
    width: 76px;
    height: 76px;
    border-radius: 50%;
    font-size: 32px;
}
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
 * @param {(dir: "up"|"down"|"left"|"right") => void} [options.onRelease]  Richtung losgelassen
 * @param {{label: string, ariaLabel?: string, keys?: string[], onPress: () => void}} [options.actionButton]
 * @param {() => boolean} [options.isActive]   nur reagieren, wenn true
 * @param {HTMLElement} [options.swipeTarget]  Element für Wischgesten
 * @returns {{ element: HTMLElement, destroy: () => void }}
 */
export function createDirectionalControls({ onDirection, onRelease = null, actionButton = null, isActive = () => true, swipeTarget = null }) {
    ensureStyles();

    const actionKeys = actionButton ? (actionButton.keys ?? [" ", "Enter"]) : [];
    const held = new Set();   // aktuell gedrückte Richtungen (Tastatur + Steuerkreuz)

    function emit(dir) {
        if (isActive()) onDirection(dir);
    }

    function release(dir) {
        if (!held.delete(dir)) return;
        if (onRelease) onRelease(dir);
    }

    function releaseAll() {
        for (const dir of [...held]) release(dir);
    }

    // --- Tastatur -------------------------------------------------------------
    function onKeyDown(event) {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const dir = KEY_DIRECTIONS[event.key];
        const isAction = actionKeys.includes(event.key);
        if (!dir && !isAction) return;
        if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
        if (!isActive()) return;
        // Pfeiltasten und Leertaste scrollen sonst die Seite; die Aktionstaste soll
        // außerdem keinen gerade fokussierten Knopf (z. B. „Lobby verlassen“) auslösen.
        event.preventDefault();
        if (event.repeat) return;
        if (isAction) {
            actionButton.onPress();
            return;
        }
        held.add(dir);
        onDirection(dir);
    }
    function onKeyUp(event) {
        const dir = KEY_DIRECTIONS[event.key];
        if (dir) release(dir);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);

    // --- Steuerkreuz ------------------------------------------------------------
    const element = document.createElement("div");
    element.className = "gk-pad";
    const dpad = document.createElement("div");
    dpad.className = "gk-dpad";
    dpad.setAttribute("role", "group");
    dpad.setAttribute("aria-label", "Steuerung");
    for (const [dir, symbol, label] of [["up", "▲", "hoch"], ["left", "◀", "links"], ["right", "▶", "rechts"], ["down", "▼", "runter"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.dir = dir;
        button.textContent = symbol;
        button.setAttribute("aria-label", label);
        button.addEventListener("pointerdown", event => {
            event.preventDefault();
            if (!isActive()) return;
            held.add(dir);
            onDirection(dir);
        });
        for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
            button.addEventListener(type, () => release(dir));
        }
        dpad.append(button);
    }
    element.append(dpad);

    if (actionButton) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gk-action";
        button.textContent = actionButton.label;
        button.setAttribute("aria-label", actionButton.ariaLabel ?? actionButton.label);
        button.addEventListener("pointerdown", event => {
            event.preventDefault();
            if (isActive()) actionButton.onPress();
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
            document.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", releaseAll);
            if (swipeTarget) {
                swipeTarget.removeEventListener("pointerdown", onPointerDown);
                swipeTarget.removeEventListener("pointerup", onPointerUp);
            }
            element.remove();
        }
    };
}
