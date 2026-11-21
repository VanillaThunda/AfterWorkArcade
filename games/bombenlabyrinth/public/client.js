/**
 * Bomben-Labyrinth – Client-Teil.
 *
 * Zeichnet die Arena auf ein Canvas (eigene Farben, auch im Dark-Mode gleich)
 * und steuert per gemeinsamem Baustein /js/game-kit/controls.js mit „Taste
 * halten“: gedrückte Richtungen landen auf einem Stapel, die zuletzt gedrückte
 * gilt. Beim Loslassen fällt die Richtung auf die vorherige zurück bzw. auf
 * Stillstand (move {dir: null}). Leertaste/Enter oder der 💣-Knopf legen eine Bombe.
 *
 * Der Server schickt alle 50 ms den vollen Zustand. Figuren gleiten lokal per
 * requestAnimationFrame zwischen den Feldern (Dauer = stepMs des Spielers).
 *
 * Aktionen:  settings {bots, wins}, start, move {dir|null}, bomb, new-match
 */

import { createDirectionalControls } from "/js/game-kit/controls.js";

export const stylesheets = ["style.css"];

const CELL = 40;   // Canvas-Pixel pro Feld
const POWERUP_ICONS = { r: "🔥", b: "💣", s: "👟" };
const COLORS = {
    floor: "#3a4a3f",
    floorAlt: "#35453a",
    wall: "#5d6475",
    wallTop: "#7a8296",
    wallShade: "#434957",
    crate: "#b7793b",
    crateDark: "#8a5624",
    crateLine: "#6e4419",
    bomb: "#1c1c22",
    flameOuter: "#ff6a00",
    flameInner: "#ffe066"
};
const FACING = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "bl-root");
    const root = createElement("div", "bl");
    const arena = createElement("div", "bl-arena");
    const canvas = createElement("canvas", "bl-canvas");
    const countdown = createElement("div", "bl-countdown");
    const banner = createElement("div", "bl-banner");
    const overlay = createElement("div", "bl-overlay");
    arena.append(canvas, countdown, banner, overlay);

    const side = createElement("div", "bl-side");
    const scoreBox = createElement("div", "bl-box");
    const stats = createElement("p", "bl-stats");
    const hint = createElement("p", "bl-hint");
    const scores = createElement("ol", "bl-scores");
    scoreBox.append(createElement("h4", null, "Punktestand"), scores, stats, hint);
    const logBox = createElement("div", "bl-box");
    const log = createElement("ul", "bl-log");
    logBox.append(createElement("h4", null, "Ereignisse"), log);
    side.append(scoreBox, logBox);

    root.append(arena, side);
    frame.append(root);
    container.append(frame);

    const g = canvas.getContext("2d");

    let state = null;
    let overlayKey = "";
    let countdownEnd = 0;     // performance.now()-Zeitpunkte, lokal fortgeschrieben
    let suddenDeathAt = 0;
    let frameRequest = null;
    let countdownTimer = null;
    const heldStack = [];     // gedrückte Richtungen, letzte = aktiv
    let lastSent;             // zuletzt gesendete Richtung (undefined = noch nichts)
    const motion = new Map(); // id → {fromX, fromY, toX, toY, start, duration}

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id) ?? null;
    const playing = () => {
        const self = me();
        return Boolean(self?.alive && (state.phase === "running" || state.phase === "countdown"));
    };

    // --- Steuerung -------------------------------------------------------------
    function sendHeld(force = false) {
        const dir = heldStack.at(-1) ?? null;
        if (!force && dir === lastSent) return;
        if (!playing()) return;
        lastSent = dir;
        ctx.sendAction({ type: "move", dir });
    }

    const controls = createDirectionalControls({
        isActive: playing,
        onDirection: dir => {
            const at = heldStack.indexOf(dir);
            if (at >= 0) heldStack.splice(at, 1);
            heldStack.push(dir);
            sendHeld();
        },
        onRelease: dir => {
            const at = heldStack.indexOf(dir);
            if (at >= 0) heldStack.splice(at, 1);
            sendHeld();
        },
        actionButton: {
            label: "💣",
            ariaLabel: "Bombe legen",
            keys: [" ", "Enter"],
            onPress: () => {
                if (state?.phase === "running") ctx.sendAction({ type: "bomb" });
            }
        }
    });
    scoreBox.append(controls.element);

    // --- Bewegung glätten ---------------------------------------------------------
    function trackMotion() {
        const now = performance.now();
        for (const player of state.players) {
            const entry = motion.get(player.id);
            if (!entry || state.phase !== "running") {
                motion.set(player.id, { fromX: player.x, fromY: player.y, toX: player.x, toY: player.y, start: now, duration: 1 });
                continue;
            }
            if (entry.toX === player.x && entry.toY === player.y) continue;
            const current = positionOf(entry, now);
            const jump = Math.abs(player.x - entry.toX) + Math.abs(player.y - entry.toY) > 1;
            motion.set(player.id, {
                fromX: jump ? player.x : current.x,
                fromY: jump ? player.y : current.y,
                toX: player.x,
                toY: player.y,
                start: now,
                duration: player.stepMs ?? 200
            });
        }
    }

    function positionOf(entry, now) {
        const t = Math.min(1, (now - entry.start) / entry.duration);
        return { x: entry.fromX + (entry.toX - entry.fromX) * t, y: entry.fromY + (entry.toY - entry.fromY) * t };
    }

    // --- Zeichnen -------------------------------------------------------------
    function drawWall(x, y) {
        const px = x * CELL;
        const py = y * CELL;
        g.fillStyle = COLORS.wallShade;
        g.fillRect(px, py, CELL, CELL);
        g.fillStyle = COLORS.wall;
        g.fillRect(px, py, CELL, CELL - 6);
        g.fillStyle = COLORS.wallTop;
        g.fillRect(px + 3, py + 3, CELL - 6, 5);
    }

    function drawCrate(x, y) {
        const px = x * CELL + 3;
        const py = y * CELL + 3;
        const size = CELL - 6;
        g.fillStyle = COLORS.crateDark;
        g.fillRect(px, py, size, size);
        g.fillStyle = COLORS.crate;
        g.fillRect(px + 3, py + 3, size - 6, size - 6);
        g.strokeStyle = COLORS.crateLine;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(px + 4, py + 4);
        g.lineTo(px + size - 4, py + size - 4);
        g.moveTo(px + size - 4, py + 4);
        g.lineTo(px + 4, py + size - 4);
        g.stroke();
    }

    function drawPowerup(x, y, kind, now) {
        const cx = (x + 0.5) * CELL;
        const cy = (y + 0.5) * CELL;
        const pulse = 1 + Math.sin(now / 180) * 0.06;
        g.fillStyle = "rgba(255, 255, 255, 0.85)";
        g.beginPath();
        g.arc(cx, cy, CELL * 0.36 * pulse, 0, Math.PI * 2);
        g.fill();
        g.font = `${Math.round(CELL * 0.5)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        g.fillText(POWERUP_ICONS[kind], cx, cy + 1);
    }

    function drawBomb(bomb, now) {
        const cx = (bomb.x + 0.5) * CELL;
        const cy = (bomb.y + 0.5) * CELL;
        const left = bomb.fuse / state.fuseTicks;            // 1 → 0
        const speed = 120 + left * 260;                         // pulsiert schneller kurz vor dem Knall
        const scale = 1 + Math.sin(now / speed) * (0.05 + (1 - left) * 0.08);
        const radius = CELL * 0.34 * scale;
        g.fillStyle = COLORS.bomb;
        g.beginPath();
        g.arc(cx, cy + 2, radius, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255, 255, 255, 0.35)";
        g.beginPath();
        g.arc(cx - radius * 0.35, cy - radius * 0.3, radius * 0.25, 0, Math.PI * 2);
        g.fill();
        // Zündschnur mit Funken
        g.strokeStyle = "#c9a25a";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(cx + radius * 0.5, cy - radius * 0.6);
        g.lineTo(cx + radius * 0.85, cy - radius * 1.05);
        g.stroke();
        g.fillStyle = Math.floor(now / 90) % 2 ? COLORS.flameInner : COLORS.flameOuter;
        g.beginPath();
        g.arc(cx + radius * 0.9, cy - radius * 1.1, 4, 0, Math.PI * 2);
        g.fill();
    }

    function drawFlames(now) {
        const flicker = Math.sin(now / 40) * 2;
        for (const flame of state.flames) {
            for (const index of flame.cells) {
                const x = (index % state.width) * CELL;
                const y = Math.floor(index / state.width) * CELL;
                g.fillStyle = COLORS.flameOuter;
                g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
                g.fillStyle = COLORS.flameInner;
                g.fillRect(x + 9 + flicker, y + 9 - flicker, CELL - 18, CELL - 18);
            }
        }
    }

    /**
     * Figur zeichnen. Stehen mehrere auf demselben Feld, wird ein Kreis mit
     * Tortenstücken in allen Farben gezeichnet (Augen von der ersten Figur).
     */
    function drawPlayer(group, pos) {
        const player = group[0];
        const cx = (pos.x + 0.5) * CELL;
        const cy = (pos.y + 0.5) * CELL;
        const radius = CELL * 0.36;
        g.fillStyle = "rgba(0, 0, 0, 0.3)";
        g.beginPath();
        g.ellipse(cx, cy + radius * 0.9, radius * 0.9, radius * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        if (group.length === 1) {
            g.fillStyle = player.color;
            g.beginPath();
            g.arc(cx, cy, radius, 0, Math.PI * 2);
            g.fill();
        } else {
            const slice = (Math.PI * 2) / group.length;
            group.forEach((member, i) => {
                const start = -Math.PI / 2 + i * slice;
                g.fillStyle = member.color;
                g.beginPath();
                g.moveTo(cx, cy);
                g.arc(cx, cy, radius, start, start + slice);
                g.closePath();
                g.fill();
            });
            g.strokeStyle = "rgba(0, 0, 0, 0.55)";
            g.lineWidth = 1.5;
            g.beginPath();
            group.forEach((_, i) => {
                const angle = -Math.PI / 2 + i * slice;
                g.moveTo(cx, cy);
                g.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            });
            g.stroke();
        }
        g.strokeStyle = "#111";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, radius, 0, Math.PI * 2);
        g.stroke();
        // Augen in Blickrichtung
        const [fx, fy] = FACING[player.facing] ?? [0, 1];
        for (const side of [-1, 1]) {
            const ex = cx + fx * radius * 0.35 + (fy !== 0 ? side * radius * 0.35 : 0);
            const ey = cy + fy * radius * 0.35 + (fx !== 0 ? side * radius * 0.35 : 0) - (fy === 0 ? radius * 0.1 : 0);
            g.fillStyle = "#fff";
            g.beginPath();
            g.arc(ex, ey, radius * 0.22, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#111";
            g.beginPath();
            g.arc(ex + fx * 2, ey + fy * 2, radius * 0.1, 0, Math.PI * 2);
            g.fill();
        }
        if (group.some(member => member.id === ctx.me.id)) {
            g.strokeStyle = "#ffffff";
            g.lineWidth = 3;
            g.beginPath();
            g.arc(cx, cy, radius + 4, 0, Math.PI * 2);
            g.stroke();
        }
    }

    function draw() {
        if (!state) return;
        const now = performance.now();
        const { width, height } = state;
        if (canvas.width !== width * CELL) {
            canvas.width = width * CELL;
            canvas.height = height * CELL;
        }
        g.textAlign = "center";
        g.textBaseline = "middle";

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                g.fillStyle = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt;
                g.fillRect(x * CELL, y * CELL, CELL, CELL);
            }
        }
        if (!state.grid) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || (x % 2 === 0 && y % 2 === 0)) drawWall(x, y);
                }
            }
            return;
        }

        const grid = state.grid;
        for (let i = 0; i < grid.length; i++) {
            const x = i % width;
            const y = Math.floor(i / width);
            const cell = grid[i];
            if (cell === "#") drawWall(x, y);
            else if (cell === "x") drawCrate(x, y);
            else if (POWERUP_ICONS[cell]) drawPowerup(x, y, cell, now);
        }
        for (const bomb of state.bombs) drawBomb(bomb, now);
        drawFlames(now);

        // Ausgeschiedene: Kreuz an der Stelle
        g.font = `bold ${Math.round(CELL * 0.8)}px Arial, sans-serif`;
        for (const player of state.players) {
            if (player.alive || !player.diedAt || player.left) continue;
            g.fillStyle = player.color;
            g.globalAlpha = 0.7;
            g.fillText("✖", (player.diedAt.x + 0.5) * CELL, (player.diedAt.y + 0.5) * CELL);
            g.globalAlpha = 1;
        }

        // Figuren, deren gezeichnete Mitte weniger als ein halbes Feld auseinanderliegt,
        // als eine geteilte Figur zeichnen (Reihenfolge wie in state.players → feste Farben)
        const groups = [];
        for (const player of state.players) {
            if (!player.alive) continue;
            const entry = motion.get(player.id);
            const pos = entry ? positionOf(entry, now) : { x: player.x, y: player.y };
            const group = groups.find(gr => Math.hypot(gr.pos.x - pos.x, gr.pos.y - pos.y) < 0.5);
            if (group) {
                group.members.push(player);
                group.points.push(pos);
            } else {
                groups.push({ pos, members: [player], points: [pos] });
            }
        }
        for (const { members, points } of groups) {
            const center = {
                x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
                y: points.reduce((sum, p) => sum + p.y, 0) / points.length
            };
            drawPlayer(members, center);
        }

        // Im Countdown: Namen über den Figuren
        if (state.phase === "countdown") {
            g.font = `bold ${Math.round(CELL * 0.42)}px Arial, sans-serif`;
            for (const player of state.players) {
                if (!player.alive) continue;
                const label = player.id === ctx.me.id ? "Du" : player.name;
                const cx = (player.x + 0.5) * CELL;
                const cy = player.y * CELL - 6;
                g.lineWidth = 4;
                g.strokeStyle = "rgba(0, 0, 0, 0.75)";
                g.strokeText(label, cx, cy);
                g.fillStyle = "#ffffff";
                g.fillText(label, cx, cy);
            }
        }
    }

    function loop() {
        frameRequest = null;
        draw();
        updateBanner();
        if (state && (state.phase === "running" || state.phase === "countdown")) {
            frameRequest = requestAnimationFrame(loop);
        }
    }

    function ensureLoop() {
        if (frameRequest === null) frameRequest = requestAnimationFrame(loop);
    }

    // --- Countdown und Hinweise (laufen lokal) ---------------------------------
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

    function updateBanner() {
        if (state?.phase !== "running") {
            banner.hidden = true;
            return;
        }
        const left = suddenDeathAt - performance.now();
        if (left > 15_000) {
            banner.hidden = true;
        } else {
            banner.hidden = false;
            banner.classList.toggle("bl-banner-alarm", left <= 0);
            banner.textContent = left > 0 ? `Arena schrumpft in ${Math.ceil(left / 1000)} s` : "Die Arena schrumpft!";
        }
    }

    // --- Leiste und Overlays -----------------------------------------------------
    function renderScores() {
        const target = state.settings.wins;
        const sorted = [...state.players].sort((a, b) => b.wins - a.wins);
        scores.replaceChildren(...sorted.map(player => {
            const item = createElement("li", player.alive || state.phase !== "running" ? "" : "bl-out");
            const swatch = createElement("span", "bl-swatch");
            swatch.style.background = player.color;
            const name = createElement("span", "bl-name", player.id === ctx.me.id ? `${player.name} (du)` : player.name);
            const wins = createElement("span", "bl-wins", "●".repeat(player.wins) + "○".repeat(Math.max(0, target - player.wins)));
            wins.setAttribute("aria-label", `${player.wins} von ${target} Siegen`);
            item.append(swatch, name, wins);
            return item;
        }));

        const self = me();
        if (self && state.phase !== "setup") {
            stats.hidden = false;
            stats.textContent = `💣 ${self.bombs}   🔥 ${self.range}   👟 ${self.speed + 1}`;
            stats.title = `Bomben: ${self.bombs} · Reichweite: ${self.range} · Tempo: Stufe ${self.speed + 1}`;
        } else {
            stats.hidden = true;
        }
        if (!self) hint.textContent = state.phase === "setup" ? "" : "Du schaust zu – nächste Partie bist du dabei.";
        else if (!self.alive && state.phase === "running") hint.textContent = "Erwischt – warte auf die nächste Runde.";
        else hint.textContent = "Laufen: Pfeiltasten oder W A S D halten · Bombe: Leertaste.";
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
        const box = createElement("div", "bl-overlay-box");
        const nameOf = id => state.players.find(p => p.id === id)?.name ?? "?";

        if (state.phase === "setup") {
            box.append(createElement("h3", null, "Bomben-Labyrinth"));
            box.append(createElement("p", null, "Sprenge dir den Weg frei, sammle Power-ups und erwische die anderen mit deinen Bomben – aber bring dich rechtzeitig in Sicherheit."));
            box.append(createElement("p", "bl-legend", "🔥 mehr Reichweite · 💣 eine Bombe mehr · 👟 schneller"));
            if (host) {
                const row = createElement("div", "bl-setup");
                row.append(
                    createSelect("Bots", "bl-bots", 0, state.settings.maxBots, state.settings.bots, value => ctx.sendAction({ type: "settings", bots: value })),
                    createSelect("Siege zum Gewinnen", "bl-wins-select", state.settings.minWins, state.settings.maxWins, state.settings.wins, value => ctx.sendAction({ type: "settings", wins: value }))
                );
                const start = createElement("button", "bl-start", "Partie starten");
                start.type = "button";
                start.disabled = state.members.length + state.settings.bots < 2;
                start.addEventListener("click", () => ctx.sendAction({ type: "start" }));
                box.append(row, start);
            } else {
                box.append(createElement("p", "bl-muted", `Bots: ${state.settings.bots} · Siege: ${state.settings.wins} – der Host startet die Partie.`));
            }
            box.append(createElement("p", "bl-muted", "Steuerung: Pfeiltasten oder W A S D halten, Leertaste legt eine Bombe. Auf dem Handy: Steuerkreuz und 💣-Knopf."));
        } else if (state.phase === "roundOver") {
            box.append(createElement("h3", null, state.roundWinner ? `${nameOf(state.roundWinner)} gewinnt Runde ${state.round}!` : `Runde ${state.round}: Unentschieden`));
            box.append(createElement("p", "bl-muted", "Gleich geht es weiter …"));
        } else if (state.phase === "finished" && state.result) {
            box.append(createElement("h3", null, state.result.winnerId ? `🏆 ${nameOf(state.result.winnerId)} gewinnt!` : "Partie beendet"));
            const list = createElement("ol", "bl-placements");
            for (const id of state.result.placements) {
                const player = state.players.find(p => p.id === id);
                list.append(createElement("li", null, `${player.name} – ${player.wins} ${player.wins === 1 ? "Sieg" : "Siege"}`));
            }
            box.append(list);
            if (host) {
                const button = createElement("button", "bl-new-match", "Neue Partie");
                button.type = "button";
                button.addEventListener("click", () => ctx.sendAction({ type: "new-match" }));
                box.append(button);
            } else {
                box.append(createElement("p", "bl-muted", "Der Host kann eine neue Partie starten."));
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
        trackMotion();
        renderScores();
        renderOverlay();
        updateCountdown();
        updateBanner();
        draw();
        ensureLoop();
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            const previousPhase = state?.phase;
            const previousRound = state?.round;
            state = newState;
            if (!state) return;
            const newRound = previousRound !== state.round;
            if (state.phase === "countdown" && (previousPhase !== "countdown" || newRound)) {
                countdownEnd = performance.now() + (state.countdownMs ?? 0);
                clearInterval(countdownTimer);
                countdownTimer = setInterval(updateCountdown, 100);
                // Der Server hat die Richtung zurückgesetzt – gehaltene Taste erneut melden
                lastSent = undefined;
                if (heldStack.length > 0) sendHeld(true);
            }
            if (state.phase === "running" && state.suddenDeathInMs !== null) {
                suddenDeathAt = performance.now() + state.suddenDeathInMs;
            }
            render();
        },
        destroy() {
            clearInterval(countdownTimer);
            if (frameRequest !== null) cancelAnimationFrame(frameRequest);
            controls.destroy();
            frame.remove();
        }
    };
}
