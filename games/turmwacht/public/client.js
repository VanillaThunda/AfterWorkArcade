/**
 * Turmwacht – Client-Teil.
 *
 * Links die Karte (Canvas, Zeichnen in render.js), rechts bzw. darunter die
 * Leiste mit Leben/Welle/Countdown, der Kasse aller Spieler (mit Schenken), der
 * Auswahl (Bau-Menü bzw. Turm-Infos) und dem Log.
 *
 * Bedienung: Feld antippen → Bau-Menü (oder Turm-Infos bei einem Turm).
 * Tastatur: 1–5 baut den Turmtyp auf dem gewählten Feld, U = Upgrade,
 * Esc = Auswahl aufheben.
 *
 * Aktionen:  settings {difficulty, waves}, new-map, start, build {x, y, tower},
 *            upgrade {towerId}, sell {towerId}, gift {to, amount}, ready,
 *            call-wave, speed, new-match
 */

import { CELL, drawMap, drawTower, drawEnemy, drawFx, drawRange, drawSelection } from "./render.js";

export const stylesheets = ["style.css"];

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function button(className, text, onClick) {
    const b = createElement("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

const isTyping = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.closest?.("dialog[open]")));
};

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "tw-root");
    const root = createElement("div", "tw");
    const stage = createElement("div", "tw-stage");
    const canvas = createElement("canvas", "tw-canvas");
    const overlay = createElement("div", "tw-overlay");
    overlay.hidden = true;
    stage.append(canvas, overlay);

    const side = createElement("div", "tw-side");
    const hud = createElement("div", "tw-hud");
    const livesEl = createElement("span", "tw-lives");
    const waveEl = createElement("span", "tw-wave");
    const timerEl = createElement("span", "tw-timer");
    hud.append(livesEl, waveEl, timerEl);
    const upcomingEl = createElement("div", "tw-upcoming");

    const actionsRow = createElement("div", "tw-actions");
    const readyBtn = button("tw-ready", "Bereit", () => ctx.sendAction({ type: "ready" }));
    const callBtn = button("tw-call", "Welle rufen", () => ctx.sendAction({ type: "call-wave" }));
    const speedBtn = button("tw-speed", "Tempo ×2", () => ctx.sendAction({ type: "speed" }));
    actionsRow.append(readyBtn, callBtn, speedBtn);

    const team = createElement("div", "tw-team");
    const panel = createElement("div", "tw-panel");
    const logBox = createElement("ul", "tw-log");
    side.append(hud, upcomingEl, actionsRow, team, panel, logBox);
    root.append(stage, side);
    frame.append(root);
    container.append(frame);

    const g = canvas.getContext("2d");
    let state = null;
    let selected = null;            // {x, y}
    let preview = null;             // Turmtyp für den Reichweiten-Kreis
    let frameRequest = null;
    let lastUpdate = 0;
    const motion = new Map();       // Gegner-id → {fx, fy, tx, ty}
    let panelKey = "";
    let teamKey = "";
    let overlayKey = "";
    let mapSeed = null;

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id && !p.left) ?? null;
    const running = () => state?.phase === "build" || state?.phase === "wave";
    const playing = () => running() && Boolean(me());
    const towerAt = (x, y) => state?.towers.find(t => t.x === x && t.y === y) ?? null;
    const cellAt = (x, y) => state.map.grid[y * state.map.cols + x];
    const playerName = id => state.players.find(p => p.id === id)?.name ?? "—";
    const playerColor = id => state.players.find(p => p.id === id && !p.left)?.color ?? null;
    const upgradeCost = tower => (tower.level >= state.world.maxLevel ? null : state.catalog.towers[tower.type].upgrades[tower.level - 1]);
    const send = action => ctx.sendAction(action);

    // --- Eingabe -----------------------------------------------------------------
    function cellFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.map.cols);
        const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.map.rows);
        return x >= 0 && y >= 0 && x < state.map.cols && y < state.map.rows ? { x, y } : null;
    }

    canvas.addEventListener("click", event => {
        if (!state || !running()) return;
        const cell = cellFromEvent(event);
        selected = cell && (towerAt(cell.x, cell.y) || cellAt(cell.x, cell.y) === ".") ? cell : null;
        preview = null;
        refresh();
    });

    function onKey(event) {
        if (!playing() || isTyping() || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Escape") {
            selected = null;
            refresh();
            return;
        }
        if (!selected) return;
        const tower = towerAt(selected.x, selected.y);
        const ids = Object.keys(state.catalog.towers);
        const index = Number(event.key) - 1;
        if (!tower && Number.isInteger(index) && index >= 0 && index < ids.length) {
            event.preventDefault();
            send({ type: "build", x: selected.x, y: selected.y, tower: ids[index] });
        } else if (tower && event.key.toLowerCase() === "u") {
            event.preventDefault();
            send({ type: "upgrade", towerId: tower.id });
        }
    }
    document.addEventListener("keydown", onKey);

    // --- Bewegung glätten ------------------------------------------------------
    function progress(now) {
        return Math.max(0, Math.min(1, (now - lastUpdate) / state.world.tickMs));
    }

    function track(now) {
        const k = lastUpdate ? progress(now) : 1;
        const seen = new Set();
        for (const e of state.enemies) {
            seen.add(e.id);
            const m = motion.get(e.id);
            if (!m) {
                motion.set(e.id, { fx: e.x, fy: e.y, tx: e.x, ty: e.y });
                continue;
            }
            m.fx += (m.tx - m.fx) * k;
            m.fy += (m.ty - m.fy) * k;
            m.tx = e.x;
            m.ty = e.y;
        }
        for (const id of motion.keys()) if (!seen.has(id)) motion.delete(id);
    }

    // --- Zeichnen -------------------------------------------------------------
    function draw() {
        if (!state?.map) return;
        const now = performance.now();
        const k = progress(now);
        drawMap(g, state.map);
        const booms = state.fx.filter(f => f.k === "boom");
        for (const tower of state.towers) {
            const aim = booms.find(f => Math.abs(f.from.x - tower.x - 0.5) < 0.01 && Math.abs(f.from.y - tower.y - 0.5) < 0.01)?.to;
            drawTower(g, tower, playerColor(tower.ownerId), state.catalog.towers[tower.type], aim);
        }
        const enemies = [...state.enemies].sort((a, b) => a.d - b.d);
        for (const enemy of enemies) {
            const m = motion.get(enemy.id);
            const x = m ? m.fx + (m.tx - m.fx) * k : enemy.x;
            const y = m ? m.fy + (m.ty - m.fy) * k : enemy.y;
            drawEnemy(g, enemy, x * CELL, y * CELL, state.catalog.enemies[enemy.type], now);
        }
        for (const effect of state.fx) drawFx(g, effect, state.tickNo - effect.t + k, state.world.fxTicks);
        if (selected && running()) {
            const tower = towerAt(selected.x, selected.y);
            const type = tower?.type ?? preview;
            const level = tower?.level ?? 1;
            if (type) drawRange(g, selected.x, selected.y, state.catalog.towers[type].levels[level - 1].range);
            drawSelection(g, selected.x, selected.y, true);
        }
        if (state.phase === "build" && state.wave === 0 && Math.floor(now / 600) % 2 === 0) {
            g.save();
            g.font = "bold 22px Arial, sans-serif";
            g.textAlign = "center";
            g.lineWidth = 5;
            g.strokeStyle = "rgba(0,0,0,0.6)";
            g.fillStyle = "#fff";
            g.strokeText("Feld antippen, um zu bauen", canvas.width / 2, 30);
            g.fillText("Feld antippen, um zu bauen", canvas.width / 2, 30);
            g.restore();
        }
    }

    function loop() {
        frameRequest = null;
        draw();
        if (state?.phase === "wave" || state?.fx.length) frameRequest = requestAnimationFrame(loop);
    }
    function ensureLoop() {
        if (frameRequest === null) frameRequest = requestAnimationFrame(loop);
    }

    // --- Leiste ------------------------------------------------------------------
    function renderHud() {
        const visible = running() || state.phase === "finished";
        for (const el of [hud, upcomingEl, actionsRow, team]) el.hidden = !visible;
        if (!visible) return;
        livesEl.textContent = `❤ ${state.lives}`;
        livesEl.classList.toggle("is-low", state.lives <= 5);
        waveEl.textContent = `Welle ${state.wave}/${state.settings.waves || "∞"}`;
        timerEl.textContent = state.phase === "build" ? `⏳ ${Math.ceil(state.buildT / 10)} s` :
            state.phase === "wave" ? `👾 ${state.enemies.length + state.spawn.length}` : "";
        upcomingEl.replaceChildren();
        if (state.upcoming) {
            upcomingEl.append(createElement("span", "tw-muted", "Nächste Welle: "));
            for (const [type, count] of Object.entries(state.upcoming)) {
                const chip = createElement("span", "tw-chip", `${count}× ${state.catalog.enemies[type].name}`);
                chip.style.setProperty("--tw-chip", state.catalog.enemies[type].color);
                upcomingEl.append(chip);
            }
        }
        const self = me();
        const active = state.players.filter(p => !p.left);
        readyBtn.hidden = !self || state.phase !== "build";
        readyBtn.textContent = `${self?.ready ? "✓ Bereit" : "Bereit"} (${active.filter(p => p.ready).length}/${active.length})`;
        readyBtn.classList.toggle("is-on", Boolean(self?.ready));
        callBtn.hidden = !isHost() || state.phase !== "build";
        speedBtn.hidden = !isHost() || !running();
        speedBtn.textContent = state.speed === 2 ? "Tempo ×1" : "Tempo ×2";
        actionsRow.hidden = actionsRow.hidden || [readyBtn, callBtn, speedBtn].every(b => b.hidden);
    }

    function renderTeam() {
        const self = me();
        const key = JSON.stringify([state.players.map(p => [p.id, p.left]), Boolean(self), running()]);
        if (key !== teamKey) {
            teamKey = key;
            team.replaceChildren();
            for (const p of state.players) {
                if (p.left) continue;
                const row = createElement("div", `tw-member${p.id === ctx.me.id ? " is-me" : ""}`);
                row.dataset.id = p.id;
                const swatch = createElement("span", "tw-swatch");
                swatch.style.background = p.color;
                const name = createElement("span", "tw-member-name", p.id === ctx.me.id ? `${p.name} (du)` : p.name);
                const gold = createElement("span", "tw-gold");
                row.append(swatch, name, gold);
                if (self && p.id !== ctx.me.id && running()) {
                    const gifts = createElement("span", "tw-gifts");
                    const small = button("tw-gift", `🎁 ${state.world.giftStep}`, () => send({ type: "gift", to: p.id, amount: state.world.giftStep }));
                    small.title = `${p.name} ${state.world.giftStep} Gold schenken`;
                    const half = button("tw-gift tw-gift-half", "🎁 ½", () => send({ type: "gift", to: p.id, amount: Math.floor((me()?.gold ?? 0) / 2) }));
                    half.title = `${p.name} die Hälfte deiner Kasse schenken`;
                    gifts.append(small, half);
                    row.append(gifts);
                }
                team.append(row);
            }
        }
        for (const row of team.children) {
            const p = state.players.find(x => x.id === row.dataset.id);
            if (!p) continue;
            row.querySelector(".tw-gold").textContent = `${p.gold} 🪙${p.ready && state.phase === "build" ? " ✓" : ""}`;
            const small = row.querySelector(".tw-gift");
            const half = row.querySelector(".tw-gift-half");
            if (small) small.disabled = (self?.gold ?? 0) < state.world.giftStep;
            if (half) half.disabled = (self?.gold ?? 0) < 2;
        }
    }

    function renderPanel() {
        const self = me();
        if (state.phase === "setup") {
            renderSetup();
            return;
        }
        if (!running()) {
            panelKey = "";
            panel.replaceChildren();
            return;
        }
        if (!self) {
            const key = "spectator";
            if (panelKey !== key) {
                panelKey = key;
                panel.replaceChildren(createElement("p", "tw-muted", "Du schaust zu – bei der nächsten Partie bist du dabei."));
            }
            return;
        }
        const tower = selected ? towerAt(selected.x, selected.y) : null;
        if (selected && !tower && cellAt(selected.x, selected.y) !== ".") selected = null;
        const key = JSON.stringify(["play", selected, tower && [tower.id, tower.level, tower.ownerId]]);
        if (key !== panelKey) {
            panelKey = key;
            panel.replaceChildren();
            if (!selected) {
                panel.append(createElement("p", "tw-muted", "Tippe ein freies Feld an, um einen Turm zu bauen, oder einen Turm, um ihn zu verbessern."));
            } else if (tower) {
                buildTowerInfo(tower);
            } else {
                buildMenu();
            }
        }
        // Gold-abhängige Zustände ohne Neuaufbau aktualisieren (Klicks bleiben erhalten)
        for (const b of panel.querySelectorAll("[data-cost]")) b.disabled = self.gold < Number(b.dataset.cost) || b.dataset.locked === "1";
        const dmg = panel.querySelector(".tw-tower-damage");
        if (dmg && tower) dmg.textContent = `Schaden bisher: ${tower.damage}`;
        const sell = panel.querySelector(".tw-sell");
        if (sell && tower) sell.textContent = `Verkaufen (+${tower.refund})`;
    }

    function buildMenu() {
        panel.append(createElement("h4", null, "Turm bauen"));
        const list = createElement("div", "tw-build");
        Object.entries(state.catalog.towers).forEach(([id, t], i) => {
            const b = button("tw-build-btn", "", () => send({ type: "build", x: selected.x, y: selected.y, tower: id }));
            b.dataset.tower = id;
            b.dataset.cost = String(t.cost);
            b.title = t.info;
            const icon = createElement("span", "tw-build-icon");
            icon.style.background = t.color;
            b.append(icon, createElement("span", "tw-build-name", `${i + 1} ${t.name}`), createElement("span", "tw-build-cost", `${t.cost} 🪙`));
            const show = () => { preview = id; draw(); };
            b.addEventListener("mouseenter", show);
            b.addEventListener("focus", show);
            list.append(b);
        });
        panel.append(list);
        const info = createElement("p", "tw-muted tw-build-info", "Upgraden darf jeder, verkaufen nur der Erbauer.");
        panel.append(info);
    }

    function buildTowerInfo(tower) {
        const t = state.catalog.towers[tower.type];
        const stats = t.levels[tower.level - 1];
        panel.append(createElement("h4", null, `${t.name} · Stufe ${tower.level}/${state.world.maxLevel}`));
        const owner = createElement("p", "tw-muted", tower.ownerId ? `Gebaut von ${playerName(tower.ownerId)}` : "Herrenlos – jeder darf verkaufen");
        panel.append(owner, createElement("p", "tw-tower-info", t.info));
        const facts = [`Schaden ${stats.damage}`, `Reichweite ${stats.range}`, `alle ${(stats.cd / 10).toFixed(1)} s`];
        if (stats.splash) facts.push(`Fläche ${stats.splash}`);
        if (stats.slow) facts.push(`bremst ${Math.round(stats.slow * 100)} %`);
        if (stats.chain) facts.push(`${stats.chain} Ziele`);
        if (stats.shots > 1) facts.push(`${stats.shots} Pfeile`);
        panel.append(createElement("p", "tw-facts", facts.join(" · ")), createElement("p", "tw-muted tw-tower-damage", ""));
        const row = createElement("div", "tw-tower-actions");
        const cost = upgradeCost(tower);
        const up = button("tw-upgrade", cost === null ? "Höchste Stufe" : `⬆ Stufe ${tower.level + 1} (${cost} 🪙)`, () => send({ type: "upgrade", towerId: tower.id }));
        up.dataset.cost = String(cost ?? 0);
        up.dataset.locked = cost === null ? "1" : "0";
        if (cost !== null) {
            const next = t.levels[tower.level];
            up.title = `Danach: Schaden ${next.damage}, Reichweite ${next.range}`;
        }
        row.append(up);
        const mayOwner = !tower.ownerId || tower.ownerId === ctx.me.id;
        if (mayOwner) {
            const sell = button("tw-sell", "", () => {
                selected = null;
                send({ type: "sell", towerId: tower.id });
            });
            row.append(sell);
        }
        panel.append(row);
    }

    function renderSetup() {
        const host = isHost();
        const key = JSON.stringify(["setup", state.settings, host, state.members.length]);
        if (key === panelKey) return;
        panelKey = key;
        panel.replaceChildren();
        panel.append(createElement("h4", null, "Turmwacht"));
        panel.append(createElement("p", null, "Baut gemeinsam Türme am Pfad und haltet die Wellen auf. Jeder Gegner am Tor kostet ein Leben – ihr habt 20."));
        panel.append(createElement("p", "tw-muted", "Gold aus Abschüssen und Wellen wird gleich verteilt. Jeder zahlt aus seiner Kasse, upgraden darf jeder, und mit 🎁 könnt ihr euch Gold schenken."));
        const waveText = n => (n === 0 ? "Endlos" : `${n} Wellen`);
        if (host) {
            const row = createElement("div", "tw-setup");
            row.append(
                createChoice("Gegner", "tw-difficulty", Object.entries(state.catalog.difficulties), state.settings.difficulty, value => send({ type: "settings", difficulty: value })),
                createChoice("Länge", "tw-waves", state.catalog.waveOptions.map(n => [String(n), waveText(n)]), String(state.settings.waves), value => send({ type: "settings", waves: Number(value) }))
            );
            panel.append(row);
            const buttons = createElement("div", "tw-setup-buttons");
            buttons.append(
                button("tw-new-map", "🎲 Neue Karte", () => send({ type: "new-map" })),
                button("tw-start", "Wacht beginnen", () => send({ type: "start" }))
            );
            panel.append(buttons);
        } else {
            panel.append(createElement("p", "tw-muted", `Gegner: ${state.catalog.difficulties[state.settings.difficulty]} · ${waveText(state.settings.waves)} – der Host würfelt die Karte und startet.`));
        }
        panel.append(createElement("p", "tw-muted", `Dabei: ${state.members.slice(0, 4).map(m => m.name).join(", ")}${state.members.length > 4 ? ` (+${state.members.length - 4} schauen zu)` : ""}`));
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

    function renderOverlay() {
        const host = isHost();
        const key = JSON.stringify([state.phase, host, state.result]);
        if (key === overlayKey) return;
        overlayKey = key;
        overlay.hidden = state.phase !== "finished";
        if (overlay.hidden) {
            overlay.replaceChildren();
            return;
        }
        const result = state.result;
        const box = createElement("div", "tw-overlay-box");
        const headline = result.outcome === "victory" ? "🏰 Verteidigt!" : result.outcome === "aborted" ? "Spiel beendet" :
            result.outcome === "endless" ? `Welle ${result.wave} erreicht` : `Gefallen in Welle ${result.wave}`;
        box.append(createElement("h3", null, headline));
        box.append(createElement("p", null, result.outcome === "victory" ? `Alle ${result.waves} Wellen abgewehrt – mit ${state.lives} Leben übrig.` :
            result.outcome === "endless" ? "Endlos-Modus: So weit seid ihr gekommen." :
                result.outcome === "aborted" ? "Alle haben die Wacht verlassen." : "Das Tor ist gefallen."));
        const winner = state.players.find(p => p.id === result.winnerId);
        if (winner && result.outcome !== "aborted") box.append(createElement("p", "tw-winner", `🏆 Turmmeister: ${winner.name}`));
        const table = createElement("table", "tw-placements");
        const head = createElement("tr");
        for (const title of ["", "Name", "Schaden", "Abschüsse", "Türme", "Investiert", "Geschenkt"]) head.append(createElement("th", null, title));
        table.append(head);
        result.placements.forEach((id, index) => {
            const p = state.players.find(x => x.id === id);
            const row = createElement("tr", p.id === ctx.me.id ? "is-me" : "");
            const swatch = createElement("span", "tw-swatch");
            swatch.style.background = p.color;
            const nameCell = createElement("td");
            nameCell.append(swatch, document.createTextNode(` ${p.name}`));
            row.append(createElement("td", null, `${index + 1}.`), nameCell);
            for (const value of [p.stats.damage, p.stats.kills, p.stats.built, p.stats.invested, p.stats.gifted]) row.append(createElement("td", "tw-num", String(value)));
            table.append(row);
        });
        box.append(table);
        if (host) box.append(button("tw-new-match", "Neue Partie", () => send({ type: "new-match" })));
        else box.append(createElement("p", "tw-muted", "Der Host kann eine neue Partie starten."));
        overlay.replaceChildren(box);
    }

    function renderLog() {
        logBox.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
        logBox.hidden = state.log.length === 0;
    }

    function refresh() {
        renderHud();
        renderTeam();
        renderPanel();
        draw();
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            const now = performance.now();
            state = newState;
            if (!state) return;
            if (canvas.width !== state.map.cols * CELL) {
                canvas.width = state.map.cols * CELL;
                canvas.height = state.map.rows * CELL;
            }
            if (mapSeed !== state.map.seed) {
                mapSeed = state.map.seed;
                selected = null;
                motion.clear();
            }
            if (!running()) selected = null;
            track(now);
            lastUpdate = now;
            root.dataset.phase = state.phase;
            renderOverlay();
            renderLog();
            refresh();
            ensureLoop();
        },
        destroy() {
            if (frameRequest !== null) cancelAnimationFrame(frameRequest);
            document.removeEventListener("keydown", onKey);
            frame.remove();
        }
    };
}
