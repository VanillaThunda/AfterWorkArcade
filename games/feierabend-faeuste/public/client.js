/**
 * Feierabend-Fäuste – Client-Teil.
 *
 * Zeigt die Figurenwahl (Setup), das laufende Spiel auf einem Canvas (Zeichnen in
 * render.js) mit HUD und das Ergebnis. Der Server schickt alle 50 ms den vollen
 * Zustand; Figuren und Kamera werden dazwischen geglättet.
 *
 * Steuerung (gemeinsamer Baustein controls.js):
 *   Pfeiltasten/WASD halten = laufen (8 Richtungen), Leertaste/J = Schlag,
 *   K/Shift = Sprung, L/E = Spezial. Touch: Steuerkreuz + 3 Knöpfe.
 *
 * Aktionen:  settings {allies, difficulty, allyLevel}, pick {figure}, start,
 *            move {dx, dz}, attack, jump, special, new-match
 */

import { createDirectionalControls } from "/js/game-kit/controls.js";
import {
    SCALE, VIEW_H, drawBackground, drawFighter, drawCrate, drawPickup, drawBottle, drawTelegraph, drawFx, lookFor, screenY, shade
} from "./render.js";

export const stylesheets = ["style.css"];

const BANNER_MS = 2200;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "ff-root");
    const root = createElement("div", "ff");
    const stage = createElement("div", "ff-stage");
    const canvas = createElement("canvas", "ff-canvas");
    const overlay = createElement("div", "ff-overlay");
    stage.append(canvas, overlay);

    const side = createElement("div", "ff-side");
    const helpBox = createElement("div", "ff-box");
    const hint = createElement("p", "ff-hint");
    helpBox.append(createElement("h4", null, "Steuerung"), hint);
    const logBox = createElement("div", "ff-box");
    const log = createElement("ul", "ff-log");
    logBox.append(createElement("h4", null, "Ereignisse"), log);
    side.append(helpBox, logBox);

    root.append(stage, side);
    frame.append(root);
    container.append(frame);

    const g = canvas.getContext("2d");
    canvas.width = 480 * SCALE;
    canvas.height = VIEW_H * SCALE;

    let state = null;
    let overlayKey = "";
    let frameRequest = null;
    let lastUpdate = 0;
    let tickMs = 50;
    const motion = new Map();            // id → {fx, fz, fh, tx, tz, th}
    let camFrom = 0;
    let camTo = 0;
    let banner = { text: "", until: 0 };
    let lastSection = null;
    const held = new Set();
    let lastMove = "0,0";

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id) ?? null;
    const canPlay = () => {
        const self = me();
        return Boolean(state?.phase === "playing" && self && !self.left && self.state !== "ko");
    };

    // --- Steuerung -------------------------------------------------------------
    function sendMove() {
        const dx = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        const dz = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
        const key = `${dx},${dz}`;
        if (key === lastMove || !canPlay()) return;
        lastMove = key;
        ctx.sendAction({ type: "move", dx, dz });
    }
    const press = type => () => {
        if (canPlay()) ctx.sendAction({ type });
    };
    const controls = createDirectionalControls({
        isActive: canPlay,
        onDirection: dir => {
            held.add(dir);
            sendMove();
        },
        onRelease: dir => {
            held.delete(dir);
            sendMove();
        },
        actionButtons: [
            { id: "attack", label: "👊", ariaLabel: "Schlag", keys: [" ", "j"], onPress: press("attack") },
            { id: "jump", label: "⤴", ariaLabel: "Sprung", keys: ["k", "Shift"], onPress: press("jump") },
            { id: "special", label: "🌀", ariaLabel: "Spezial", keys: ["l", "e"], onPress: press("special") }
        ]
    });
    helpBox.append(controls.element);

    // --- Bewegung glätten ------------------------------------------------------
    function progress(now) {
        return Math.max(0, Math.min(1, (now - lastUpdate) / tickMs));
    }

    function track(entities, now) {
        const k = progress(now);
        const seen = new Set();
        for (const e of entities) {
            seen.add(e.id);
            const m = motion.get(e.id);
            if (!m || Math.abs(m.tx - e.x) > 60) {
                motion.set(e.id, { fx: e.x, fz: e.z, fh: e.h ?? 0, tx: e.x, tz: e.z, th: e.h ?? 0 });
                continue;
            }
            m.fx = m.fx + (m.tx - m.fx) * k;
            m.fz = m.fz + (m.tz - m.fz) * k;
            m.fh = m.fh + (m.th - m.fh) * k;
            m.tx = e.x;
            m.tz = e.z;
            m.th = e.h ?? 0;
        }
        for (const id of motion.keys()) if (!seen.has(id)) motion.delete(id);
    }

    function posOf(e, k) {
        const m = motion.get(e.id);
        if (!m) return { x: e.x, z: e.z, h: e.h ?? 0 };
        return { x: m.fx + (m.tx - m.fx) * k, z: m.fz + (m.tz - m.fz) * k, h: m.fh + (m.th - m.fh) * k };
    }

    // --- Zeichnen -------------------------------------------------------------
    function draw() {
        if (!state) return;
        const now = performance.now();
        const k = progress(now);
        const width = canvas.width;
        const height = canvas.height;
        const camX = camFrom + (camTo - camFrom) * k;
        g.save();
        if (state.shake > 0) g.translate((Math.random() - 0.5) * 8 * SCALE, (Math.random() - 0.5) * 6 * SCALE);
        drawBackground(g, state.sectionId, camX, width, height);
        if (state.phase === "setup") {
            g.restore();
            return;
        }

        const tFrac = k;
        const drawables = [];
        for (const crate of state.crates) drawables.push({ z: crate.z, draw: () => drawCrate(g, (crate.x - camX) * SCALE, screenY(crate.z), crate) });
        for (const food of state.pickups) drawables.push({ z: food.z, draw: () => drawPickup(g, (food.x - camX) * SCALE, screenY(food.z), now) });
        for (const enemy of state.enemies) {
            const pos = posOf(enemy, k);
            drawables.push({
                z: pos.z,
                draw: () => drawFighter(g, enemy, (pos.x - camX) * SCALE, screenY(pos.z, pos.h), enemy.animT + tFrac, {
                    look: lookFor(enemy), facing: enemy.facing, flash: enemy.flash > 0,
                    alpha: enemy.state === "dying" ? (Math.floor(now / 80) % 2 ? 0.25 : 0.8) : 1
                })
            });
        }
        for (const player of state.players) {
            if (player.left) continue;
            const pos = posOf(player, k);
            const self = player.id === ctx.me.id;
            drawables.push({
                z: pos.z,
                draw: () => {
                    // Farbring unter den Füßen
                    g.strokeStyle = player.color;
                    g.lineWidth = 2 * SCALE;
                    g.beginPath();
                    g.ellipse((pos.x - camX) * SCALE, screenY(pos.z), 15 * SCALE, 5 * SCALE, 0, 0, Math.PI * 2);
                    g.stroke();
                    drawFighter(g, player, (pos.x - camX) * SCALE, screenY(pos.z, pos.h), player.animT + tFrac, {
                        look: lookFor(player), facing: player.facing, flash: player.flash > 0 || (player.invuln > 0 && Math.floor(now / 70) % 2 === 0),
                        label: self ? "Du" : player.name.replace("🤖 ", "🤖"), labelColor: self ? "#ffe066" : "#fff"
                    });
                    if (player.state === "ko") drawKo(player, (pos.x - camX) * SCALE, screenY(pos.z));
                }
            });
        }
        for (const bottle of state.projectiles) drawables.push({ z: bottle.z, draw: () => drawBottle(g, (bottle.x - camX) * SCALE, screenY(bottle.z, bottle.h), now) });
        for (const enemy of state.enemies) drawTelegraph(g, enemy, camX, now);
        drawables.sort((a, b) => a.z - b.z).forEach(d => d.draw());
        for (const effect of state.fx) drawFx(g, effect, state.tickNo - effect.t + k, camX);
        g.restore();
        drawHud(now);
    }

    function drawKo(player, sx, sy) {
        g.font = `bold ${8 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.fillStyle = "#fff";
        g.fillText("K.O.", sx, sy - 22 * SCALE);
        const share = player.ko ? player.ko.revive / state.world.reviveTicks : 0;
        const own = player.ko ? Math.min(1, player.ko.t / state.world.selfReviveTicks) : 0;
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(sx - 16 * SCALE, sy - 18 * SCALE, 32 * SCALE, 4 * SCALE);
        g.fillStyle = share > 0 ? "#6ee07a" : "#aaa";
        g.fillRect(sx - 16 * SCALE, sy - 18 * SCALE, 32 * SCALE * Math.max(share, own), 4 * SCALE);
    }

    function drawHud(now) {
        const players = state.players.filter(p => !p.left);
        const panelW = 116 * SCALE;
        players.forEach((p, i) => {
            const x = (4 + i * 119) * SCALE;
            const y = 4 * SCALE;
            g.fillStyle = "rgba(10, 12, 20, 0.6)";
            g.fillRect(x, y, panelW, 22 * SCALE);
            g.fillStyle = p.color;
            g.fillRect(x, y, 4 * SCALE, 22 * SCALE);
            g.font = `bold ${7 * SCALE}px Arial, sans-serif`;
            g.textAlign = "left";
            g.textBaseline = "top";
            g.fillStyle = p.id === ctx.me.id ? "#ffe066" : "#fff";
            const name = p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name;
            g.fillText(name, x + 7 * SCALE, y + 2.5 * SCALE);
            g.textAlign = "right";
            g.fillStyle = "#ffd23f";
            g.fillText(`💥 ${p.stats.damage}`, x + panelW - 3 * SCALE, y + 2.5 * SCALE);
            const share = Math.max(0, p.hp) / p.maxHp;
            g.fillStyle = "rgba(255,255,255,0.15)";
            g.fillRect(x + 7 * SCALE, y + 13 * SCALE, panelW - 10 * SCALE, 5 * SCALE);
            g.fillStyle = p.state === "ko" ? "#777" : share > 0.5 ? "#4caf50" : share > 0.25 ? "#ffb300" : "#e53935";
            g.fillRect(x + 7 * SCALE, y + 13 * SCALE, (panelW - 10 * SCALE) * share, 5 * SCALE);
        });

        const boss = state.enemies.find(e => e.type === "boss");
        if (boss) {
            const w = 260 * SCALE;
            const x = (480 * SCALE - w) / 2;
            const y = (VIEW_H - 16) * SCALE;
            g.fillStyle = "rgba(10, 12, 20, 0.7)";
            g.fillRect(x - 4 * SCALE, y - 11 * SCALE, w + 8 * SCALE, 24 * SCALE);
            g.fillStyle = "#fff";
            g.font = `bold ${7 * SCALE}px Arial, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "bottom";
            g.fillText("Schichtleiter", 240 * SCALE, y - 1 * SCALE);
            g.fillStyle = "#3a0d0d";
            g.fillRect(x, y, w, 7 * SCALE);
            g.fillStyle = "#e53935";
            g.fillRect(x, y, w * Math.max(0, boss.hp) / boss.maxHp, 7 * SCALE);
        }

        if (state.go && Math.floor(now / 400) % 2 === 0) {
            g.font = `bold ${16 * SCALE}px Arial, sans-serif`;
            g.textAlign = "right";
            g.textBaseline = "middle";
            g.lineWidth = 4 * SCALE;
            g.strokeStyle = "#000";
            g.strokeText("Weiter →", 470 * SCALE, 110 * SCALE);
            g.fillStyle = "#ffe066";
            g.fillText("Weiter →", 470 * SCALE, 110 * SCALE);
        }

        if (state.transition > 0) {
            const half = state.world.transitionTicks / 2;
            g.fillStyle = `rgba(0, 0, 0, ${1 - Math.abs(state.transition - half) / half})`;
            g.fillRect(0, 0, canvas.width, canvas.height);
        }
        const bannerText = state.intro > 0 ? "Los geht's!" : now < banner.until ? banner.text : "";
        if (bannerText && state.phase === "playing") {
            g.font = `bold ${24 * SCALE}px Arial, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.lineWidth = 6 * SCALE;
            g.strokeStyle = "rgba(0,0,0,0.8)";
            g.strokeText(bannerText, 240 * SCALE, 120 * SCALE);
            g.fillStyle = "#ffe066";
            g.fillText(bannerText, 240 * SCALE, 120 * SCALE);
        }
    }

    function loop() {
        frameRequest = null;
        draw();
        if (state?.phase === "playing") frameRequest = requestAnimationFrame(loop);
    }
    function ensureLoop() {
        if (frameRequest === null) frameRequest = requestAnimationFrame(loop);
    }

    // --- Overlays ---------------------------------------------------------------
    function renderOverlay() {
        const host = isHost();
        const key = JSON.stringify([state.phase, state.settings, state.picks, host, state.members.length, state.result]);
        if (key === overlayKey) return;
        overlayKey = key;
        const visible = state.phase === "setup" || state.phase === "finished";
        overlay.hidden = !visible;
        if (!visible) {
            overlay.replaceChildren();
            return;
        }
        const box = createElement("div", "ff-overlay-box");
        if (state.phase === "setup") renderSetup(box, host);
        else renderResult(box, host);
        overlay.replaceChildren(box);
    }

    function renderSetup(box, host) {
        box.append(createElement("h3", null, "Feierabend-Fäuste"));
        box.append(createElement("p", null, "Kämpft euch gemeinsam durch Hinterhof, Lagerhalle und Dach bis zum Schichtleiter. Wer den meisten Schaden austeilt, wird Mitarbeiter des Abends."));
        const cards = createElement("div", "ff-figures");
        const nameOf = id => state.members.find(m => m.id === id)?.name ?? "?";
        for (const [id, figure] of Object.entries(state.catalog.figures)) {
            const owner = Object.entries(state.picks).find(([, f]) => f === id)?.[0] ?? null;
            const card = createElement("button", "ff-figure");
            card.type = "button";
            card.dataset.figure = id;
            card.style.setProperty("--ff-figure-color", figure.color);
            card.classList.toggle("is-mine", owner === ctx.me.id);
            card.disabled = Boolean(owner && owner !== ctx.me.id);
            card.append(
                createElement("strong", null, figure.name),
                createElement("span", "ff-figure-role", `${figure.role} · ${figure.hp} LP`),
                createElement("span", "ff-figure-info", figure.info),
                createElement("span", "ff-figure-owner", owner ? (owner === ctx.me.id ? "✓ deine Figur" : nameOf(owner)) : "frei")
            );
            card.addEventListener("click", () => ctx.sendAction({ type: "pick", figure: id }));
            cards.append(card);
        }
        box.append(cards);

        const maxAllies = Math.max(0, Math.min(state.settings.maxAllies, 4 - state.members.length));
        if (host) {
            const row = createElement("div", "ff-setup");
            row.append(
                createChoice("Bot-Kollegen", "ff-allies", Array.from({ length: maxAllies + 1 }, (_, n) => [String(n), String(n)]), String(Math.min(state.settings.allies, maxAllies)), value => ctx.sendAction({ type: "settings", allies: Number(value) })),
                createChoice("Gegner", "ff-difficulty", Object.entries(state.catalog.difficulties), state.settings.difficulty, value => ctx.sendAction({ type: "settings", difficulty: value })),
                createChoice("Bot-Stärke", "ff-ally-level", Object.entries(state.catalog.allyLevels), state.settings.allyLevel, value => ctx.sendAction({ type: "settings", allyLevel: value }))
            );
            const start = createElement("button", "ff-start", "Schicht beginnen");
            start.type = "button";
            start.addEventListener("click", () => ctx.sendAction({ type: "start" }));
            box.append(row, start);
        } else {
            const allies = Math.min(state.settings.allies, maxAllies);
            box.append(createElement("p", "ff-muted", `Gegner: ${state.catalog.difficulties[state.settings.difficulty]} · Bot-Kollegen: ${allies}${allies > 0 ? ` (${state.catalog.allyLevels[state.settings.allyLevel].toLowerCase()})` : ""} – der Host startet.`));
        }
        box.append(createElement("p", "ff-muted", "Laufen: Pfeiltasten/WASD · Schlag: Leertaste oder J (3× = Kombo) · Sprung: K · Spezial: L (kostet Lebenspunkte). Liegt jemand am Boden: daneben stellen hilft auf."));
    }

    function renderResult(box, host) {
        const result = state.result;
        const headline = result.outcome === "victory" ? "🎉 Feierabend!" : result.outcome === "defeat" ? "Schicht verloren" : "Spiel beendet";
        box.append(createElement("h3", null, headline));
        box.append(createElement("p", null, result.outcome === "victory" ? "Der Schichtleiter ist besiegt." : result.outcome === "defeat" ? "Alle lagen gleichzeitig am Boden." : "Das Spiel wurde abgebrochen."));
        const winner = state.players.find(p => p.id === result.winnerId);
        if (winner) box.append(createElement("p", "ff-winner", `🏆 Mitarbeiter des Abends: ${winner.name}`));
        const table = createElement("table", "ff-placements");
        const head = createElement("tr");
        for (const title of ["", "Name", "Schaden", "Treffer", "K.-o.s", "Boss", "Am Boden"]) head.append(createElement("th", null, title));
        table.append(head);
        result.placements.forEach((id, index) => {
            const p = state.players.find(x => x.id === id);
            const row = createElement("tr", p.id === ctx.me.id ? "is-me" : "");
            const swatch = createElement("span", "ff-swatch");
            swatch.style.background = p.color;
            const nameCell = createElement("td");
            nameCell.append(swatch, document.createTextNode(` ${p.name}`));
            row.append(createElement("td", null, `${index + 1}.`), nameCell);
            for (const value of [p.stats.damage, p.stats.hits, p.stats.kos, p.stats.bossDamage, p.stats.downs]) row.append(createElement("td", "ff-num", String(value)));
            table.append(row);
        });
        box.append(table);
        if (host) {
            const again = createElement("button", "ff-new-match", "Neue Schicht");
            again.type = "button";
            again.addEventListener("click", () => ctx.sendAction({ type: "new-match" }));
            box.append(again);
        } else {
            box.append(createElement("p", "ff-muted", "Der Host kann eine neue Schicht starten."));
        }
    }

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

    function renderSide() {
        const self = me();
        if (state.phase === "playing" && !self) hint.textContent = "Du schaust zu – bei der nächsten Schicht bist du dabei.";
        else if (self?.state === "ko") hint.textContent = "K.O.! Ein Mitspieler kann dir aufhelfen, sonst stehst du nach 10 s selbst wieder auf.";
        else hint.textContent = "Pfeiltasten/WASD laufen · Leertaste/J Schlag · K Sprung · L Spezial";
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            const now = performance.now();
            const previous = state;
            state = newState;
            if (!state) return;
            tickMs = state.world.tickMs;
            const entities = [...state.players, ...state.enemies];
            track(entities, now);
            camFrom = previous?.sectionId === state.sectionId ? camFrom + (camTo - camFrom) * progress(now) : state.camX;
            camTo = state.camX;
            lastUpdate = now;
            root.dataset.phase = state.phase;
            if (state.phase === "playing" && lastSection !== `${state.matchNumber}/${state.sectionId}`) {
                lastSection = `${state.matchNumber}/${state.sectionId}`;
                banner = { text: state.sectionName, until: now + BANNER_MS };
            }
            if (state.phase !== "playing") {
                held.clear();
                lastMove = "0,0";
            }
            renderOverlay();
            renderSide();
            draw();
            ensureLoop();
        },
        destroy() {
            if (frameRequest !== null) cancelAnimationFrame(frameRequest);
            controls.destroy();
            frame.remove();
        }
    };
}
