/**
 * Artillerie-Duell – Client-Teil.
 *
 * Zeichnet Himmel, Höhenprofil-Gelände und Panzer auf ein Canvas (eigene Farben,
 * in beiden Designs gleich). In der Zielphase stellt man Winkel, Kraft und Waffe
 * ein und kann ein Stück fahren; „Feuer frei“ meldet sich bereit. In der
 * Flugphase spielt der Client die vom Server berechnete Salve (state.flight) als
 * Animation ab: Geschosse, Krater, Explosionen, Schaden, Stürze.
 *
 * Steuerung: ←/→ fahren, ↑/↓ Rohr drehen (gemeinsamer Baustein controls.js),
 * Q/E Kraft, Leertaste Feuer frei. Auf Touch-Geräten Steuerkreuz und 🔥-Knopf.
 *
 * Aktionen:  settings {bots, wins}, start, aim {angle, power, weapon}, move {dir},
 *            ready {angle, power, weapon, ready}, new-match
 */

import { createDirectionalControls } from "/js/game-kit/controls.js";

export const stylesheets = ["style.css"];

const SCALE = 2;                    // Canvas-Pixel pro Welteinheit (scharf auf hochauflösenden Displays)
const SAMPLE_S = 0.04;              // Abstand der Pfadpunkte (wie SAMPLE_EVERY × DT im Server)
const FALL_ANIM_S = 0.6;
const AIM_SEND_MS = 150;
const REPEAT_MS = 70;
const DRIVE_REPEAT_MS = 170;
const WEAPON_ICONS = { granate: "💣", splitter: "✴️", bohrer: "🔩" };
const COLORS = {
    skyTop: "#4a90c9",
    skyBottom: "#bfe3f5",
    earth: "#8a5a32",
    earthDark: "#6b4424",
    grass: "#4f9a3a",
    trail: "rgba(255, 255, 255, 0.75)",
    shell: "#1b1b1b",
    blast: "#ffb703",
    blastCore: "#fff3b0"
};

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/** Krater sprengen – Kopie von carve() aus games/artillerie/game.js (muss gleich rechnen). */
function carve(heights, col, cx, cy, r) {
    for (let i = Math.floor((cx - r) / col); i <= Math.floor((cx + r) / col); i++) {
        if (i < 0 || i >= heights.length) continue;
        const dx = (i + 0.5) * col - cx;
        if (Math.abs(dx) > r) continue;
        const half = Math.sqrt(r * r - dx * dx);
        const bottom = cy - half;
        const top = cy + half;
        const h = heights[i];
        if (h <= bottom) continue;
        heights[i] = Math.max(0, Math.round(h - (Math.min(h, top) - bottom)));
    }
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "ad-root");
    const root = createElement("div", "ad");
    const stage = createElement("div", "ad-stage");
    const canvas = createElement("canvas", "ad-canvas");
    const banner = createElement("div", "ad-banner");
    const overlay = createElement("div", "ad-overlay");
    stage.append(canvas, banner, overlay);

    // Bedienleiste (Zielphase)
    const panel = createElement("div", "ad-panel");
    const angleInput = createRange("ad-angle", 0, 180);
    const powerInput = createRange("ad-power", 10, 100);
    const angleValue = createElement("output", "ad-value");
    const powerValue = createElement("output", "ad-value");
    const angleRow = createElement("label", "ad-slider");
    angleRow.append(createElement("span", null, "Winkel"), angleInput, angleValue);
    const powerRow = createElement("label", "ad-slider");
    powerRow.append(createElement("span", null, "Kraft"), powerInput, powerValue);
    const weaponRow = createElement("div", "ad-weapons");
    weaponRow.setAttribute("role", "group");
    weaponRow.setAttribute("aria-label", "Waffe");
    const driveRow = createElement("div", "ad-drive");
    const driveLeft = createElement("button", "ad-drive-left", "◀");
    const driveRight = createElement("button", "ad-drive-right", "▶");
    driveLeft.type = driveRight.type = "button";
    driveLeft.setAttribute("aria-label", "nach links fahren");
    driveRight.setAttribute("aria-label", "nach rechts fahren");
    const fuelBar = createElement("span", "ad-fuel");
    const fuelFill = createElement("span", "ad-fuel-fill");
    fuelBar.append(fuelFill);
    driveRow.append(driveLeft, createElement("span", "ad-fuel-label", "Treibstoff"), fuelBar, driveRight);
    const fireButton = createElement("button", "ad-fire", "🔥 Feuer frei");
    fireButton.type = "button";
    const panelStatus = createElement("p", "ad-panel-status");
    panel.append(angleRow, powerRow, weaponRow, driveRow, fireButton, panelStatus);

    const side = createElement("div", "ad-side");
    const scoreBox = createElement("div", "ad-box");
    const scores = createElement("ol", "ad-scores");
    const hint = createElement("p", "ad-hint");
    scoreBox.append(createElement("h4", null, "Panzer"), scores, hint);
    const logBox = createElement("div", "ad-box");
    const log = createElement("ul", "ad-log");
    logBox.append(createElement("h4", null, "Ereignisse"), log);
    side.append(scoreBox, logBox);

    root.append(stage, panel, side);
    frame.append(root);
    container.append(frame);

    const g = canvas.getContext("2d");

    let state = null;
    let overlayKey = "";
    let frameRequest = null;
    let phaseEnd = 0;            // performance.now(), wann die aktuelle Phase endet
    let flightStart = 0;         // performance.now(), wann die Flugphase begann
    let flightKey = null;        // welche Salve gerade animiert wird
    let localHeights = null;     // Gelände während der Animation
    let carveIndex = 0;
    let aim = { angle: 45, power: 60, weapon: "granate" };
    let aimVolley = null;        // für welche Salve aim aus dem Server übernommen wurde
    let aimTimer = null;
    let aimDirty = false;
    const lastAngles = new Map(); // zuletzt bekannte Rohrwinkel der anderen
    const heldTimers = new Map(); // gehaltene Richtungen → Wiederhol-Timer
    let lastStatusKey = "";

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id) ?? null;
    const canAim = () => {
        const self = me();
        return Boolean(state?.phase === "aiming" && self?.alive && !self.ready);
    };

    // --- Zielen und Senden -----------------------------------------------------
    function createRange(className, min, max) {
        const input = createElement("input", className);
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.step = "1";
        return input;
    }

    function setAim(changes) {
        if (!canAim()) return;
        aim = { ...aim, ...changes };
        aim.angle = Math.max(0, Math.min(180, Math.round(aim.angle)));
        aim.power = Math.max(10, Math.min(100, Math.round(aim.power)));
        aimDirty = true;
        if (!aimTimer) {
            aimTimer = setTimeout(() => {
                aimTimer = null;
                if (aimDirty && canAim()) ctx.sendAction({ type: "aim", ...aim });
                aimDirty = false;
            }, AIM_SEND_MS);
        }
        renderPanel();
        draw();
    }

    function toggleReady() {
        const self = me();
        if (state?.phase !== "aiming" || !self?.alive) return;
        clearTimeout(aimTimer);
        aimTimer = null;
        aimDirty = false;
        ctx.sendAction({ type: "ready", ...aim, ready: !self.ready });
    }

    function drive(dir) {
        if (!canAim() || (me()?.fuel ?? 0) <= 0) return;
        ctx.sendAction({ type: "move", dir });
    }

    angleInput.addEventListener("input", () => setAim({ angle: Number(angleInput.value) }));
    powerInput.addEventListener("input", () => setAim({ power: Number(powerInput.value) }));
    fireButton.addEventListener("click", toggleReady);
    driveLeft.addEventListener("click", () => drive(-1));
    driveRight.addEventListener("click", () => drive(1));
    for (const id of ["granate", "splitter", "bohrer"]) {
        const button = createElement("button", "ad-weapon");
        button.type = "button";
        button.dataset.weapon = id;
        button.addEventListener("click", () => setAim({ weapon: id }));
        weaponRow.append(button);
    }

    // Tastatur/Touch: ←/→ fahren, ↑/↓ Rohr drehen (gehalten = wiederholen)
    function repeatAction(dir) {
        if (dir === "left") drive(-1);
        else if (dir === "right") drive(1);
        else if (dir === "up") setAim({ angle: aim.angle + 1 });
        else if (dir === "down") setAim({ angle: aim.angle - 1 });
    }
    const controls = createDirectionalControls({
        isActive: canAim,
        onDirection: dir => {
            repeatAction(dir);
            clearInterval(heldTimers.get(dir));
            const every = dir === "left" || dir === "right" ? DRIVE_REPEAT_MS : REPEAT_MS;
            heldTimers.set(dir, setInterval(() => (canAim() ? repeatAction(dir) : stopHeld(dir)), every));
        },
        onRelease: dir => stopHeld(dir),
        actionButton: { label: "🔥", ariaLabel: "Feuer frei", keys: [" "], onPress: toggleReady }
    });
    function stopHeld(dir) {
        clearInterval(heldTimers.get(dir));
        heldTimers.delete(dir);
    }
    panel.append(controls.element);

    // Kraft mit Q/E (Wiederholung beim Halten erlaubt)
    function onPowerKey(event) {
        const key = event.key.toLowerCase();
        if (key !== "q" && key !== "e") return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target instanceof Element && event.target.closest("input:not([type=range]), textarea, select, [contenteditable]")) return;
        if (document.querySelector("dialog[open]") || !canAim()) return;
        event.preventDefault();
        setAim({ power: aim.power + (key === "e" ? 1 : -1) });
    }
    document.addEventListener("keydown", onPowerKey);

    // --- Zeichnen -------------------------------------------------------------
    const sy = (y) => (state.world.height - y) * SCALE;
    const sx = (x) => x * SCALE;

    function drawSky() {
        const gradient = g.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, COLORS.skyTop);
        gradient.addColorStop(1, COLORS.skyBottom);
        g.fillStyle = gradient;
        g.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawTerrain(heights) {
        const col = state.world.col;
        g.beginPath();
        g.moveTo(0, canvas.height);
        heights.forEach((h, i) => {
            g.lineTo(sx(i * col), sy(h));
            g.lineTo(sx((i + 1) * col), sy(h));
        });
        g.lineTo(canvas.width, canvas.height);
        g.closePath();
        const gradient = g.createLinearGradient(0, sy(300), 0, canvas.height);
        gradient.addColorStop(0, COLORS.earth);
        gradient.addColorStop(1, COLORS.earthDark);
        g.fillStyle = gradient;
        g.fill();
        // Grasnarbe
        g.strokeStyle = COLORS.grass;
        g.lineWidth = 3 * SCALE;
        g.lineJoin = "round";
        g.beginPath();
        heights.forEach((h, i) => {
            const y = sy(h) + 1.5 * SCALE;
            if (i === 0) g.moveTo(0, y);
            g.lineTo(sx((i + 0.5) * col), y);
        });
        g.stroke();
    }

    function drawTank(player, y, angle, { hp = player.hp, wreck = false } = {}) {
        const { tankHalf, tankHeight, barrel, startHp } = state.world;
        const x = player.x;
        // Rohr
        if (!wreck && angle !== null && angle !== undefined) {
            const rad = (angle * Math.PI) / 180;
            const bx = x;
            const by = y + tankHeight * 0.8;
            g.strokeStyle = "#222";
            g.lineWidth = 3 * SCALE;
            g.lineCap = "round";
            g.beginPath();
            g.moveTo(sx(bx), sy(by));
            g.lineTo(sx(bx + Math.cos(rad) * barrel), sy(by + Math.sin(rad) * barrel));
            g.stroke();
        }
        // Kuppel und Wanne
        g.fillStyle = wreck ? "#3a3a3a" : player.color;
        g.strokeStyle = "#1a1a1a";
        g.lineWidth = 1.5 * SCALE;
        g.beginPath();
        g.arc(sx(x), sy(y + tankHeight * 0.6), tankHalf * 0.55 * SCALE, Math.PI, 0);
        g.fill();
        g.stroke();
        g.beginPath();
        g.roundRect(sx(x - tankHalf), sy(y + tankHeight * 0.6), tankHalf * 2 * SCALE, tankHeight * 0.6 * SCALE, 3 * SCALE);
        g.fill();
        g.stroke();
        // Ketten
        g.fillStyle = "#2b2b2b";
        g.beginPath();
        g.roundRect(sx(x - tankHalf - 1), sy(y + 3), (tankHalf * 2 + 2) * SCALE, 3 * SCALE, 1.5 * SCALE);
        g.fill();
        if (wreck) {
            g.font = `${12 * SCALE}px sans-serif`;
            g.textAlign = "center";
            g.fillText("💥", sx(x), sy(y + tankHeight + 6));
            return;
        }
        // Name und Trefferpunkte
        const label = player.id === ctx.me.id ? "Du" : player.name;
        g.font = `bold ${11 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.lineWidth = 3 * SCALE;
        g.strokeStyle = "rgba(0, 0, 0, 0.6)";
        g.strokeText(label, sx(x), sy(y + tankHeight + 13));
        g.fillStyle = "#fff";
        g.fillText(label, sx(x), sy(y + tankHeight + 13));
        const barWidth = tankHalf * 2.4;
        const left = x - barWidth / 2;
        const top = y + tankHeight + 8;
        g.fillStyle = "rgba(0, 0, 0, 0.55)";
        g.fillRect(sx(left), sy(top), barWidth * SCALE, 4 * SCALE);
        const share = Math.max(0, hp) / startHp;
        g.fillStyle = share > 0.5 ? "#4caf50" : share > 0.25 ? "#ffb300" : "#e53935";
        g.fillRect(sx(left), sy(top), barWidth * share * SCALE, 4 * SCALE);
    }

    function drawWind() {
        const wind = state.wind ?? 0;
        const cx = canvas.width / 2;
        const cy = 20 * SCALE;
        g.fillStyle = "rgba(0, 0, 0, 0.35)";
        g.beginPath();
        g.roundRect(cx - 80 * SCALE, cy - 13 * SCALE, 160 * SCALE, 26 * SCALE, 13 * SCALE);
        g.fill();
        g.fillStyle = "#fff";
        g.font = `bold ${13 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const strength = Math.round((Math.abs(wind) / state.world.windMax) * 10);
        const arrow = wind === 0 ? "–" : (wind > 0 ? "→".repeat(Math.max(1, Math.ceil(strength / 3))) : "←".repeat(Math.max(1, Math.ceil(strength / 3))));
        g.fillText(`Wind ${arrow} ${strength}`, cx, cy);
    }

    /** Aktuelle Zeit innerhalb der Flugphase (s). */
    function flightTime() {
        return Math.max(0, (performance.now() - flightStart) / 1000);
    }

    function drawFlight() {
        const flight = state.flight;
        const t = flightTime();
        const col = state.world.col;
        while (carveIndex < flight.carves.length && flight.carves[carveIndex].t <= t) {
            const c = flight.carves[carveIndex++];
            carve(localHeights, col, c.x, c.y, c.r);
        }
        drawTerrain(localHeights);

        const shotsEnd = (flight.durationMs - (flight.falls.length > 0 ? FALL_ANIM_S * 1000 : 0)) / 1000;
        for (const player of state.players) {
            if (player.left) continue;
            const fall = flight.falls.find(f => f.id === player.id);
            let y = player.y;
            if (fall) {
                const k = Math.max(0, Math.min(1, (t - shotsEnd) / FALL_ANIM_S));
                y = fall.fromY + (fall.toY - fall.fromY) * k * k;
            }
            const pendingDamage = flight.hits.filter(h => h.target === player.id && h.t > t).reduce((s, h) => s + h.amount, 0)
                + (fall && t < shotsEnd + FALL_ANIM_S ? fall.damage : 0);
            const hp = player.hp + pendingDamage;
            const lastHit = Math.max(-1, ...flight.hits.filter(h => h.target === player.id).map(h => h.t));
            const wreck = !player.alive && t >= Math.max(lastHit, fall ? shotsEnd + FALL_ANIM_S : -1);
            const shot = flight.shots.find(s => s.owner === player.id && !s.fragment);
            const angle = shot ? player.angle ?? lastAngles.get(player.id) : lastAngles.get(player.id);
            drawTank(player, y, angle, { hp, wreck });
        }

        // Geschosse mit Schweif
        for (const shot of flight.shots) {
            const local = t - shot.t0;
            const end = (shot.t1 ?? Infinity) - shot.t0;
            if (local < 0 || local > end) continue;
            const pos = local / SAMPLE_S;
            const index = Math.min(shot.path.length - 1, Math.floor(pos));
            const from = Math.max(0, index - 6);
            g.strokeStyle = COLORS.trail;
            g.lineWidth = (shot.fragment ? 1 : 2) * SCALE;
            g.beginPath();
            for (let i = from; i <= index; i++) {
                const [px, py] = shot.path[i];
                if (i === from) g.moveTo(sx(px), sy(py));
                else g.lineTo(sx(px), sy(py));
            }
            g.stroke();
            const [px, py] = shot.path[index];
            g.fillStyle = COLORS.shell;
            g.beginPath();
            g.arc(sx(px), sy(py), (shot.fragment ? 1.8 : 3) * SCALE, 0, Math.PI * 2);
            g.fill();
        }

        // Explosionen
        for (const blast of flight.explosions) {
            const age = t - blast.t;
            if (age < 0 || age > 0.5) continue;
            const k = age / 0.5;
            g.globalAlpha = 1 - k;
            g.fillStyle = COLORS.blast;
            g.beginPath();
            g.arc(sx(blast.x), sy(blast.y), blast.r * (0.4 + 0.8 * k) * SCALE, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = COLORS.blastCore;
            g.beginPath();
            g.arc(sx(blast.x), sy(blast.y), blast.r * 0.45 * (1 - k) * SCALE, 0, Math.PI * 2);
            g.fill();
            g.globalAlpha = 1;
        }

        // Schadenszahlen
        g.font = `bold ${15 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const numbers = [
            ...flight.hits.map(h => ({ t: h.t, id: h.target, amount: h.amount })),
            ...flight.falls.filter(f => f.damage > 0).map(f => ({ t: shotsEnd + FALL_ANIM_S, id: f.id, amount: f.damage }))
        ];
        for (const n of numbers) {
            const age = t - n.t;
            if (age < 0 || age > 1.3) continue;
            const player = state.players.find(p => p.id === n.id);
            if (!player) continue;
            g.globalAlpha = 1 - age / 1.3;
            const x = sx(player.x);
            const y = sy(player.y + 30 + age * 25);
            g.lineWidth = 3 * SCALE;
            g.strokeStyle = "#000";
            g.strokeText(`−${n.amount}`, x, y);
            g.fillStyle = "#ffdd57";
            g.fillText(`−${n.amount}`, x, y);
            g.globalAlpha = 1;
        }
    }

    function draw() {
        if (!state) return;
        const { width, height } = state.world;
        if (canvas.width !== width * SCALE) {
            canvas.width = width * SCALE;
            canvas.height = height * SCALE;
        }
        drawSky();
        if (!state.heights) {
            g.fillStyle = COLORS.earth;
            g.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height);
            return;
        }
        if (state.phase === "flight" && state.flight) {
            drawFlight();
        } else {
            drawTerrain(state.heights);
            for (const player of state.players) {
                if (player.left) continue;
                const angle = player.id === ctx.me.id && state.phase === "aiming" ? aim.angle : (player.angle ?? lastAngles.get(player.id));
                drawTank(player, player.y, angle, { wreck: !player.alive });
            }
        }
        if (state.phase === "aiming" || state.phase === "flight") drawWind();
    }

    function loop() {
        frameRequest = null;
        draw();
        updateBanner();
        if (state && (state.phase === "flight" || state.phase === "aiming")) frameRequest = requestAnimationFrame(loop);
    }
    function ensureLoop() {
        if (frameRequest === null) frameRequest = requestAnimationFrame(loop);
    }

    // --- Anzeigen ---------------------------------------------------------------
    function updateBanner() {
        if (!state || (state.phase !== "aiming" && state.phase !== "flight")) {
            banner.hidden = true;
            return;
        }
        banner.hidden = false;
        if (state.phase === "aiming") {
            const left = Math.max(0, Math.ceil((phaseEnd - performance.now()) / 1000));
            banner.textContent = `Runde ${state.round} · Salve ${state.volley}/${state.maxVolleys} · noch ${left} s zielen`;
            banner.classList.toggle("ad-banner-alarm", left <= 5);
        } else {
            banner.textContent = `Runde ${state.round} · Salve ${state.volley}/${state.maxVolleys} · Feuer!`;
            banner.classList.remove("ad-banner-alarm");
        }
    }

    function renderPanel() {
        const self = me();
        const visible = state.phase === "aiming" && Boolean(self?.alive);
        panel.hidden = !visible;
        if (!visible) return;
        const active = canAim();
        if (document.activeElement !== angleInput) angleInput.value = String(aim.angle);
        if (document.activeElement !== powerInput) powerInput.value = String(aim.power);
        angleValue.textContent = `${aim.angle}°`;
        powerValue.textContent = String(aim.power);
        angleInput.disabled = powerInput.disabled = !active;
        for (const button of weaponRow.children) {
            const id = button.dataset.weapon;
            const ammo = id === "granate" ? "∞" : String(self.ammo[id] ?? 0);
            button.textContent = `${WEAPON_ICONS[id]} ${state.weapons[id].name} (${ammo})`;
            button.disabled = !active || (id !== "granate" && !(self.ammo[id] > 0));
            button.setAttribute("aria-pressed", String(aim.weapon === id));
        }
        fuelFill.style.width = `${(self.fuel / state.world.fuel) * 100}%`;
        driveLeft.disabled = driveRight.disabled = !active || self.fuel <= 0;
        fireButton.textContent = self.ready ? "✓ Bereit – nochmal klicken zum Ändern" : "🔥 Feuer frei";
        fireButton.classList.toggle("is-ready", self.ready);
        const waiting = state.players.filter(p => p.alive && !p.ready).map(p => (p.id === ctx.me.id ? "dich" : p.name));
        const statusKey = waiting.join(",");
        if (statusKey !== lastStatusKey) {
            lastStatusKey = statusKey;
            panelStatus.textContent = waiting.length > 0 ? `Warte auf: ${waiting.join(", ")}` : "Alle bereit!";
        }
    }

    function renderScores() {
        const target = state.settings.wins;
        const sorted = [...state.players].sort((a, b) => (b.wins - a.wins) || (b.hp - a.hp));
        scores.replaceChildren(...sorted.map(player => {
            const item = createElement("li", player.alive || state.phase === "setup" ? "" : "ad-out");
            const swatch = createElement("span", "ad-swatch");
            swatch.style.background = player.color;
            const name = createElement("span", "ad-name", player.id === ctx.me.id ? `${player.name} (du)` : player.name);
            const ready = createElement("span", "ad-ready", state.phase === "aiming" && player.alive && player.ready ? "✓" : "");
            ready.title = "bereit";
            const hp = createElement("span", "ad-hp", player.alive ? `${player.hp} HP` : "zerstört");
            const wins = createElement("span", "ad-wins", "●".repeat(player.wins) + "○".repeat(Math.max(0, target - player.wins)));
            wins.setAttribute("aria-label", `${player.wins} von ${target} Siegen`);
            item.append(swatch, name, ready, hp, wins);
            return item;
        }));
        const self = me();
        if (!self) hint.textContent = state.phase === "setup" ? "" : "Du schaust zu – nächste Partie bist du dabei.";
        else if (!self.alive && state.phase !== "setup" && state.phase !== "finished") hint.textContent = "Dein Panzer ist zerstört – warte auf die nächste Runde.";
        else hint.textContent = "←/→ fahren · ↑/↓ Rohr drehen · Q/E Kraft · Leertaste: Feuer frei";
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
        const box = createElement("div", "ad-overlay-box");
        const nameOf = id => state.players.find(p => p.id === id)?.name ?? "?";

        if (state.phase === "setup") {
            box.append(createElement("h3", null, "Artillerie-Duell"));
            box.append(createElement("p", null, "Alle zielen gleichzeitig – dann fliegen die Granaten. Achte auf den Wind und nutze das Gelände."));
            box.append(createElement("p", "ad-legend", "💣 Granate · ✴️ Splitter (zerplatzt) · 🔩 Bohrer (durchschlägt Hügel)"));
            if (host) {
                const row = createElement("div", "ad-setup");
                row.append(
                    createSelect("Bots", "ad-bots", 0, state.settings.maxBots, state.settings.bots, value => ctx.sendAction({ type: "settings", bots: value })),
                    createChoice("Bot-Stärke", "ad-bot-level", Object.entries(state.botLevels), state.settings.botLevel, value => ctx.sendAction({ type: "settings", botLevel: value })),
                    createSelect("Siege zum Gewinnen", "ad-wins-select", state.settings.minWins, state.settings.maxWins, state.settings.wins, value => ctx.sendAction({ type: "settings", wins: value }))
                );
                const start = createElement("button", "ad-start", "Partie starten");
                start.type = "button";
                start.disabled = state.members.length + state.settings.bots < 2;
                start.addEventListener("click", () => ctx.sendAction({ type: "start" }));
                box.append(row, start);
            } else {
                const level = state.botLevels[state.settings.botLevel] ?? "";
                box.append(createElement("p", "ad-muted", `Bots: ${state.settings.bots}${state.settings.bots > 0 ? ` (${level.toLowerCase()})` : ""} · Siege: ${state.settings.wins} – der Host startet die Partie.`));
            }
            box.append(createElement("p", "ad-muted", "Steuerung: ←/→ fahren, ↑/↓ Rohr drehen, Q/E Kraft, Leertaste Feuer frei – oder die Regler unter dem Spielfeld."));
        } else if (state.phase === "roundOver") {
            box.append(createElement("h3", null, state.roundWinner ? `${nameOf(state.roundWinner)} gewinnt Runde ${state.round}!` : `Runde ${state.round}: Unentschieden`));
            box.append(createElement("p", "ad-muted", "Gleich geht es weiter …"));
        } else if (state.phase === "finished" && state.result) {
            box.append(createElement("h3", null, state.result.winnerId ? `🏆 ${nameOf(state.result.winnerId)} gewinnt!` : "Partie beendet"));
            const list = createElement("ol", "ad-placements");
            for (const id of state.result.placements) {
                const player = state.players.find(p => p.id === id);
                list.append(createElement("li", null, `${player.name} – ${player.wins} ${player.wins === 1 ? "Sieg" : "Siege"}, ${player.damageDealt} Schaden`));
            }
            box.append(list);
            if (host) {
                const button = createElement("button", "ad-new-match", "Neue Partie");
                button.type = "button";
                button.addEventListener("click", () => ctx.sendAction({ type: "new-match" }));
                box.append(button);
            } else {
                box.append(createElement("p", "ad-muted", "Der Host kann eine neue Partie starten."));
            }
        }
        overlay.replaceChildren(box);
    }

    /** Auswahlfeld mit Text-Optionen: options = [[wert, text], …]. */
    function createChoice(labelText, className, options, current, onChange) {
        const label = createElement("label", null, `${labelText} `);
        const select = createElement("select", className);
        for (const [value, text] of options) {
            const option = createElement("option", null, text);
            option.value = value;
            option.selected = value === current;
            select.append(option);
        }
        select.addEventListener("change", () => onChange(select.value));
        label.append(select);
        return label;
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
        renderScores();
        renderOverlay();
        renderPanel();
        updateBanner();
        draw();
        ensureLoop();
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            state = newState;
            if (!state) return;
            for (const player of state.players) {
                if (player.angle !== null && player.angle !== undefined) lastAngles.set(player.id, player.angle);
            }
            if (state.phase === "aiming") {
                phaseEnd = performance.now() + (state.aimingMs ?? 0);
                const self = me();
                const key = `${state.matchNumber}/${state.round}/${state.volley}`;
                if (self && aimVolley !== key) {
                    aimVolley = key;
                    aim = { angle: self.angle, power: self.power, weapon: self.weapon };
                }
            }
            if (state.phase === "flight" && state.flight) {
                const key = `${state.matchNumber}/${state.round}/${state.flight.volley}`;
                if (flightKey !== key) {
                    flightKey = key;
                    const total = state.flight.durationMs + state.flightPadMs;
                    flightStart = performance.now() - Math.max(0, total - (state.flightMs ?? total));
                    localHeights = [...state.flight.heightsBefore];
                    carveIndex = 0;
                }
            }
            render();
        },
        destroy() {
            clearTimeout(aimTimer);
            for (const timer of heldTimers.values()) clearInterval(timer);
            if (frameRequest !== null) cancelAnimationFrame(frameRequest);
            document.removeEventListener("keydown", onPowerKey);
            controls.destroy();
            frame.remove();
        }
    };
}
