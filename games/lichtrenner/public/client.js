/**
 * Lichtrenner – Client-Teil.
 *
 * Zeichnet die Arena auf ein Canvas (dunkel, auch im hellen Design) und
 * steuert per gemeinsamem Baustein /js/game-kit/controls.js (Pfeiltasten,
 * WASD, Steuerkreuz auf Touch-Geräten, Wischen).
 *
 * Der Server schickt bei jedem Tick (100 ms) den vollen Zustand; gezeichnet
 * wird bei jedem update(). Der Countdown läuft lokal weiter (Restzeit vom
 * Server, keine absoluten Uhrzeiten).
 *
 * Aktionen:  settings {bots, wins}, start, turn {dir}, new-match
 */

import { createDirectionalControls } from "/js/game-kit/controls.js";

export const stylesheets = ["style.css"];

const CELL = 12;                 // Canvas-Pixel pro Feld
const OWNER_CHARS = "ABCDEFGH";
const ARENA_BG = "#0b0f1a";
const GRID_LINE = "rgba(120, 160, 255, 0.07)";
const ARROWS = { up: "▲", down: "▼", left: "◀", right: "▶" };

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/** Farbe abdunkeln (für Spuren ausgeschiedener Spieler). */
function dim(hex, factor) {
    const value = parseInt(hex.slice(1), 16);
    const r = Math.round(((value >> 16) & 255) * factor);
    const g = Math.round(((value >> 8) & 255) * factor);
    const b = Math.round((value & 255) * factor);
    return `rgb(${r}, ${g}, ${b})`;
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "lr-root");
    const root = createElement("div", "lr");
    const arena = createElement("div", "lr-arena");
    const canvas = createElement("canvas", "lr-canvas");
    const countdown = createElement("div", "lr-countdown");
    const overlay = createElement("div", "lr-overlay");
    arena.append(canvas, countdown, overlay);

    // Unter der Arena: Punktestand (mit Steuerhinweis/Steuerkreuz) und Ereignisse
    const side = createElement("div", "lr-side");
    const scoreBox = createElement("div", "lr-box");
    const hint = createElement("p", "lr-hint");
    const scores = createElement("ol", "lr-scores");
    scoreBox.append(createElement("h4", null, "Punktestand"), scores, hint);
    const logBox = createElement("div", "lr-box");
    const log = createElement("ul", "lr-log");
    logBox.append(createElement("h4", null, "Ereignisse"), log);
    side.append(scoreBox, logBox);

    root.append(arena, side);
    frame.append(root);
    container.append(frame);

    const context2d = canvas.getContext("2d");

    let state = null;
    let overlayKey = "";
    let lastSentDir = null;
    let countdownEnd = 0;   // performance.now()-Zeitpunkt, an dem der Countdown endet
    let countdownTimer = null;

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id) ?? null;

    // --- Steuerung -------------------------------------------------------------
    const controls = createDirectionalControls({
        isActive: () => {
            const self = me();
            return Boolean(self?.alive && (state.phase === "running" || state.phase === "countdown"));
        },
        onDirection: dir => {
            if (dir === lastSentDir) return;
            lastSentDir = dir;
            ctx.sendAction({ type: "turn", dir });
        },
        swipeTarget: canvas
    });
    scoreBox.append(controls.element);

    // --- Zeichnen -------------------------------------------------------------
    function drawArena() {
        const { width, height } = state;
        if (canvas.width !== width * CELL) {
            canvas.width = width * CELL;
            canvas.height = height * CELL;
        }
        context2d.shadowBlur = 0;
        context2d.fillStyle = ARENA_BG;
        context2d.fillRect(0, 0, canvas.width, canvas.height);

        // Gitter
        context2d.strokeStyle = GRID_LINE;
        context2d.lineWidth = 1;
        context2d.beginPath();
        for (let x = 0; x <= width; x += 4) {
            context2d.moveTo(x * CELL + 0.5, 0);
            context2d.lineTo(x * CELL + 0.5, canvas.height);
        }
        for (let y = 0; y <= height; y += 4) {
            context2d.moveTo(0, y * CELL + 0.5);
            context2d.lineTo(canvas.width, y * CELL + 0.5);
        }
        context2d.stroke();

        if (!state.grid) return;
        const players = state.players;
        const colors = players.map(p => (p.alive || state.phase !== "running" ? p.color : dim(p.color, 0.45)));

        // Spuren
        const grid = state.grid;
        for (let i = 0; i < grid.length; i++) {
            const owner = OWNER_CHARS.indexOf(grid[i]);
            if (owner < 0) continue;
            context2d.fillStyle = colors[owner];
            context2d.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }

        // Köpfe mit Leuchten, Absturzstellen
        context2d.textAlign = "center";
        context2d.textBaseline = "middle";
        for (const player of players) {
            if (player.alive) {
                context2d.shadowColor = player.color;
                context2d.shadowBlur = 18;
                context2d.fillStyle = "#ffffff";
                context2d.fillRect(player.x * CELL, player.y * CELL, CELL, CELL);
                context2d.shadowBlur = 0;
            } else if (player.crashedAt) {
                context2d.font = `bold ${CELL * 1.8}px Arial, sans-serif`;
                context2d.fillStyle = "#ff4d4d";
                context2d.fillText("✖", (player.crashedAt.x + 0.5) * CELL, (player.crashedAt.y + 0.5) * CELL);
            }
        }

        // Im Countdown: Richtungspfeile und Namen an den Startpunkten
        if (state.phase === "countdown") {
            for (const player of players) {
                if (!player.alive) continue;
                const cx = (player.x + 0.5) * CELL;
                const cy = (player.y + 0.5) * CELL;
                context2d.font = `bold ${CELL * 2}px Arial, sans-serif`;
                context2d.fillStyle = player.color;
                const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[player.dir];
                context2d.fillText(ARROWS[player.dir], cx + dx * CELL * 2, cy + dy * CELL * 2);
                context2d.font = `bold ${CELL * 1.3}px Arial, sans-serif`;
                context2d.fillStyle = "#ffffff";
                const label = player.id === ctx.me.id ? "Du" : player.name;
                context2d.fillText(label, cx - dx * CELL * 2.5, cy - dy * CELL * 2.5 - (dx !== 0 ? CELL * 1.6 : 0));
            }
        }
    }

    // --- Countdown (läuft lokal) ------------------------------------------------
    function updateCountdown() {
        if (state?.phase !== "countdown") {
            countdown.hidden = true;
            clearInterval(countdownTimer);
            countdownTimer = null;
            return;
        }
        const left = Math.max(0, countdownEnd - performance.now());
        countdown.hidden = false;
        countdown.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "Los!";
    }

    // --- Leiste und Overlays -----------------------------------------------------
    function renderScores() {
        const target = state.settings.wins;
        const sorted = [...state.players].sort((a, b) => b.wins - a.wins);
        scores.replaceChildren(...sorted.map(player => {
            const item = createElement("li", player.alive || state.phase !== "running" ? "" : "lr-out");
            const swatch = createElement("span", "lr-swatch");
            swatch.style.background = player.color;
            const name = createElement("span", "lr-name", player.id === ctx.me.id ? `${player.name} (du)` : player.name);
            const wins = createElement("span", "lr-wins", "●".repeat(player.wins) + "○".repeat(Math.max(0, target - player.wins)));
            wins.setAttribute("aria-label", `${player.wins} von ${target} Siegen`);
            item.append(swatch, name, wins);
            return item;
        }));

        const self = me();
        if (!self) hint.textContent = state.phase === "setup" ? "" : "Du schaust zu – nächste Partie bist du dabei.";
        else if (!self.alive && state.phase === "running") hint.textContent = "Gecrasht – warte auf die nächste Runde.";
        else hint.textContent = "Steuern mit Pfeiltasten oder W A S D.";
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
    }

    function renderOverlay() {
        const host = isHost();
        const key = JSON.stringify([state.phase, state.settings, host, state.members.length, state.round, state.roundWinner, state.result]);
        if (key === overlayKey) return;
        overlayKey = key;

        const visible = ["setup", "roundOver", "finished"].includes(state.phase);
        overlay.hidden = !visible;
        if (!visible) {
            overlay.replaceChildren();
            return;
        }
        const box = createElement("div", "lr-overlay-box");
        const nameOf = id => state.players.find(p => p.id === id)?.name ?? "?";

        if (state.phase === "setup") {
            box.append(createElement("h3", null, "Lichtrenner"));
            box.append(createElement("p", null, "Fahr, ohne gegen Wände oder Spuren zu stoßen – und schneide den anderen den Weg ab."));
            if (host) {
                const row = createElement("div", "lr-setup");
                row.append(
                    createSelect("Bots", "lr-bots", 0, state.settings.maxBots, state.settings.bots, value => ctx.sendAction({ type: "settings", bots: value })),
                    createSelect("Siege zum Gewinnen", "lr-wins-select", state.settings.minWins, state.settings.maxWins, state.settings.wins, value => ctx.sendAction({ type: "settings", wins: value }))
                );
                const start = createElement("button", "lr-start", "Partie starten");
                start.type = "button";
                start.disabled = state.members.length + state.settings.bots < 2;
                start.addEventListener("click", () => ctx.sendAction({ type: "start" }));
                box.append(row, start);
            } else {
                box.append(createElement("p", "lr-muted", `Bots: ${state.settings.bots} · Siege: ${state.settings.wins} – der Host startet die Partie.`));
            }
            box.append(createElement("p", "lr-muted", "Steuerung: Pfeiltasten oder W A S D, auf dem Handy Steuerkreuz oder Wischen."));
        } else if (state.phase === "roundOver") {
            box.append(createElement("h3", null, state.roundWinner ? `${nameOf(state.roundWinner)} gewinnt Runde ${state.round}!` : `Runde ${state.round}: Unentschieden`));
            box.append(createElement("p", "lr-muted", "Gleich geht es weiter …"));
        } else if (state.phase === "finished" && state.result) {
            box.append(createElement("h3", null, state.result.winnerId ? `🏆 ${nameOf(state.result.winnerId)} gewinnt!` : "Partie beendet"));
            const list = createElement("ol", "lr-placements");
            for (const id of state.result.placements) {
                const player = state.players.find(p => p.id === id);
                list.append(createElement("li", null, `${player.name} – ${player.wins} ${player.wins === 1 ? "Sieg" : "Siege"}`));
            }
            box.append(list);
            if (host) {
                const button = createElement("button", "lr-new-match", "Neue Partie");
                button.type = "button";
                button.addEventListener("click", () => ctx.sendAction({ type: "new-match" }));
                box.append(button);
            } else {
                box.append(createElement("p", "lr-muted", "Der Host kann eine neue Partie starten."));
            }
        }
        overlay.replaceChildren(box);
    }

    function createSelect(labelText, className, min, max, current, onChange) {
        const label = createElement("label", null, `${labelText} `);
        const select = createElement("select", className);
        for (let value = min; value <= max; value++) {
            const option = createElement("option", null, String(value));
            option.value = String(value);
            option.selected = value === current;
            select.append(option);
        }
        select.addEventListener("change", () => onChange(Number(select.value)));
        label.append(select);
        return label;
    }

    function render() {
        if (!state) return;
        root.dataset.phase = state.phase;
        const self = me();
        if (self) lastSentDir = state.phase === "countdown" ? self.dir : lastSentDir;
        drawArena();
        renderScores();
        renderOverlay();
        updateCountdown();
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            const previousPhase = state?.phase;
            const previousRound = state?.round;
            state = newState;
            if (!state) return;
            if (state.phase === "countdown" && (previousPhase !== "countdown" || previousRound !== state.round)) {
                countdownEnd = performance.now() + (state.countdownMs ?? 0);
                lastSentDir = null;
                clearInterval(countdownTimer);
                countdownTimer = setInterval(updateCountdown, 100);
            }
            render();
        },
        destroy() {
            clearInterval(countdownTimer);
            controls.destroy();
            frame.remove();
        }
    };
}
