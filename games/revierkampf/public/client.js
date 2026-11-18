/**
 * Revierkampf – Client-Teil.
 *
 * Zeichnet die Karte auf ein Canvas (1 Pixel pro Feld, ohne Glättung
 * hochskaliert) und schickt Klicks als Aktionen an den Server:
 *   Startphase → { type: "spawn", x, y }
 *   Runde      → { type: "attack", x, y, percent }
 *
 * Alle Namen werden per textContent bzw. auf das Canvas geschrieben –
 * nie per innerHTML (Schutz vor XSS).
 */

export const stylesheets = ["style.css"];

/** Interne Auflösung: Pixel pro Feld (für scharfe Beschriftungen). */
const SCALE = 8;
const WATER = "~";
const NEUTRAL = ".";
const OWNER_CHARS = "ABCDEFGHIJKLMNOP";
const WATER_RGB = [143, 184, 222];
const NEUTRAL_RGB = [228, 224, 212];
const PERCENT_STORAGE_KEY = "rk-percent";

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 1234 → "1234", 12345 → "12,3k" */
function formatTroops(value) {
    const rounded = Math.floor(value);
    return rounded >= 10000 ? `${(rounded / 1000).toFixed(1).replace(".", ",")}k` : String(rounded);
}

function loadPercent() {
    try {
        const stored = Number(localStorage.getItem(PERCENT_STORAGE_KEY));
        return stored >= 10 && stored <= 100 ? stored : 50;
    } catch {
        return 50;
    }
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const root = createElement("div", "rk");
    const main = createElement("div", "rk-main");
    const mapWrap = createElement("div", "rk-map");
    const canvas = createElement("canvas", "rk-canvas");
    const banner = createElement("div", "rk-banner");
    const overlay = createElement("div", "rk-overlay");
    mapWrap.append(canvas, banner, overlay);

    // Leiste unter der Karte: eigene Werte und Angriffsstärke
    const bar = createElement("div", "rk-bar");
    const stats = createElement("div", "rk-stats");
    const sliderLabel = createElement("label", "rk-slider");
    const sliderText = createElement("span");
    const slider = createElement("input");
    slider.type = "range";
    slider.min = "10";
    slider.max = "100";
    slider.step = "5";
    slider.value = String(loadPercent());
    slider.setAttribute("aria-label", "Angriffsstärke in Prozent");
    sliderLabel.append(sliderText, slider);
    bar.append(stats, sliderLabel);
    main.append(mapWrap, bar);

    // Seitenleiste: Rangliste und Ereignisse
    const side = createElement("div", "rk-side");
    const ranking = createElement("ol", "rk-ranking");
    const log = createElement("ul", "rk-log");
    side.append(createElement("h4", null, "Rangliste"), ranking, createElement("h4", null, "Ereignisse"), log);

    root.append(main, side);
    const frame = createElement("div", "rk-root"); // Bezugsrahmen für Container-Queries
    frame.append(root);
    container.append(frame);

    const context2d = canvas.getContext("2d");
    const offscreen = document.createElement("canvas");
    const offscreenContext = offscreen.getContext("2d");

    let state = null;
    let overlayKey = ""; // verhindert unnötiges Neuaufbauen des Overlays

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const myIndex = () => (state ? state.players.findIndex(p => p.id === ctx.me.id) : -1);

    // --- Eingaben ------------------------------------------------------------
    function updateSliderText() {
        sliderText.textContent = `Angriffsstärke: ${slider.value} %`;
    }
    updateSliderText();

    slider.addEventListener("input", () => {
        updateSliderText();
        try {
            localStorage.setItem(PERCENT_STORAGE_KEY, slider.value);
        } catch {
            // nicht kritisch
        }
    });

    /** Bildschirmposition → Feldkoordinaten. */
    function cellFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.width);
        const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
        if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
        return { x, y };
    }

    canvas.addEventListener("click", event => {
        if (!state || !state.grid) return;
        const cell = cellFromEvent(event);
        if (!cell) return;

        if (state.phase === "spawn") {
            ctx.sendAction({ type: "spawn", ...cell });
        } else if (state.phase === "running") {
            ctx.sendAction({ type: "attack", ...cell, percent: Number(slider.value) });
        }
    });

    // --- Karte zeichnen ------------------------------------------------------
    function drawMap() {
        const { width, height, grid, players } = state;
        if (canvas.width !== width * SCALE) {
            canvas.width = width * SCALE;
            canvas.height = height * SCALE;
            offscreen.width = width;
            offscreen.height = height;
        }

        if (!grid) {
            context2d.fillStyle = "#d9d5c7";
            context2d.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const colors = players.map(p => hexToRgb(p.color));
        const me = myIndex();
        const image = offscreenContext.createImageData(width, height);
        const data = image.data;

        for (let i = 0; i < grid.length; i++) {
            const cell = grid[i];
            let rgb;
            if (cell === WATER) {
                rgb = WATER_RGB;
            } else if (cell === NEUTRAL) {
                rgb = NEUTRAL_RGB;
            } else {
                const owner = OWNER_CHARS.indexOf(cell);
                rgb = colors[owner];
                const x = i % width;
                const isBorder =
                    (x > 0 && grid[i - 1] !== cell) || (x < width - 1 && grid[i + 1] !== cell) ||
                    (i >= width && grid[i - width] !== cell) || (i + width < grid.length && grid[i + width] !== cell);
                // Grenzen dunkler, das Innere etwas heller – eigenes Revier kräftiger
                const factor = isBorder ? 0.6 : owner === me ? 0.95 : 1.15;
                rgb = rgb.map(c => Math.min(255, Math.round(c * factor)));
            }
            data[i * 4] = rgb[0];
            data[i * 4 + 1] = rgb[1];
            data[i * 4 + 2] = rgb[2];
            data[i * 4 + 3] = 255;
        }

        offscreenContext.putImageData(image, 0, 0);
        context2d.imageSmoothingEnabled = false;
        context2d.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
        drawLabels();
    }

    /** Name und Truppen im Schwerpunkt jedes Reviers. */
    function drawLabels() {
        const { width, grid, players } = state;
        const sums = players.map(() => ({ x: 0, y: 0, n: 0 }));
        for (let i = 0; i < grid.length; i++) {
            const owner = OWNER_CHARS.indexOf(grid[i]);
            if (owner < 0) continue;
            const sum = sums[owner];
            sum.x += i % width;
            sum.y += Math.floor(i / width);
            sum.n++;
        }

        context2d.textAlign = "center";
        context2d.textBaseline = "middle";
        context2d.lineJoin = "round";

        // Schriftgröße in Bildschirm-Pixeln planen und in Canvas-Pixel umrechnen,
        // damit Namen unabhängig von der Kartengröße lesbar bleiben.
        const displayScale = canvas.clientWidth > 0 ? canvas.clientWidth / canvas.width : 1;

        players.forEach((player, index) => {
            const { x, y, n } = sums[index];
            if (n === 0) return;
            const size = Math.max(10, Math.min(22, 7 + Math.sqrt(n) * 0.35)) / displayScale;
            // Schwerpunkt, aber so weit vom Rand, dass die Schrift nicht abgeschnitten wird
            const cx = Math.min(canvas.width - size * 2.5, Math.max(size * 2.5, (x / n + 0.5) * SCALE));
            const cy = Math.min(canvas.height - size * 1.1, Math.max(size * 1.1, (y / n + 0.5) * SCALE));
            const troops = state.phase === "spawn" ? "" : formatTroops(player.troops);

            context2d.font = `bold ${size}px Arial, sans-serif`;
            context2d.lineWidth = Math.max(2, size / 5);
            context2d.strokeStyle = "rgba(255, 255, 255, 0.85)";
            context2d.fillStyle = "#1b1b1b";
            context2d.strokeText(player.name, cx, cy - (troops ? size * 0.55 : 0));
            context2d.fillText(player.name, cx, cy - (troops ? size * 0.55 : 0));
            if (troops) {
                context2d.font = `${size * 0.85}px Arial, sans-serif`;
                context2d.strokeText(troops, cx, cy + size * 0.5);
                context2d.fillText(troops, cx, cy + size * 0.5);
            }
        });
    }

    // --- Leisten und Overlays -----------------------------------------------
    function renderStats() {
        const me = state.players[myIndex()];
        if (!me) {
            stats.textContent = state.phase === "setup" ? "" : "Du schaust zu – nächste Runde bist du dabei.";
            return;
        }
        if (!me.alive && state.phase === "running") {
            stats.textContent = "Du bist ausgeschieden – schau den anderen zu.";
            return;
        }
        const share = state.landCells ? Math.round((me.cells / state.landCells) * 1000) / 10 : 0;
        stats.replaceChildren(
            createElement("span", "rk-swatch"),
            createElement("strong", null, `${formatTroops(me.troops)} / ${formatTroops(me.maxTroops)}`),
            createElement("span", "rk-muted", " Truppen · "),
            createElement("strong", null, String(me.cells)),
            createElement("span", "rk-muted", ` Felder (${String(share).replace(".", ",")} %)`)
        );
        stats.firstChild.style.background = me.color;
    }

    function renderRanking() {
        const sorted = state.players
            .map((player, index) => ({ player, index }))
            .sort((a, b) => b.player.cells - a.player.cells || a.index - b.index);

        ranking.replaceChildren(...sorted.map(({ player }) => {
            const item = createElement("li", player.alive ? "" : "rk-dead");
            const swatch = createElement("span", "rk-swatch");
            swatch.style.background = player.color;
            const percent = state.landCells ? (player.cells / state.landCells) * 100 : 0;
            const share = (percent < 10 ? percent.toFixed(1) : Math.round(percent).toString()).replace(".", ",");
            const label = player.id === ctx.me.id ? `${player.name} (du)` : player.name;
            item.append(swatch, createElement("span", "rk-name", label), createElement("span", "rk-share", `${share} %`));
            return item;
        }));
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
    }

    function renderBanner() {
        let text = "";
        if (state.phase === "spawn") {
            const me = state.players[myIndex()];
            text = me
                ? `${me.spawn ? "Startpunkt gesetzt – du kannst ihn noch versetzen." : "Klicke auf die Karte, um deinen Startpunkt zu wählen."} Noch ${state.spawnSecondsLeft} s`
                : `Startphase – noch ${state.spawnSecondsLeft} s`;
        } else if (state.phase === "running" && myIndex() >= 0 && state.players[myIndex()].alive) {
            text = "Klicke auf ein benachbartes Gebiet, um anzugreifen.";
        }
        banner.textContent = text;
        banner.hidden = !text;
    }

    function renderOverlay() {
        const host = isHost();
        const key = [state.phase, host, state.settings.bots, state.members.length, state.winner].join("|");
        if (key === overlayKey) return;
        overlayKey = key;

        overlay.hidden = state.phase !== "setup" && state.phase !== "finished";
        if (overlay.hidden) return;

        const box = createElement("div", "rk-overlay-box");

        if (state.phase === "setup") {
            box.append(createElement("h3", null, "Revierkampf"));
            box.append(createElement("p", "rk-muted",
                "Erweitere dein Revier ins freie Land und erobere die Gebiete deiner Nachbarn. " +
                "Truppen wachsen mit der Zeit – wer 70 % des Landes besitzt oder als Letzter übrig bleibt, gewinnt."));
            box.append(createElement("p", null, `Mitspieler: ${state.members.map(m => m.name).join(", ")}`));

            if (host) {
                const row = createElement("div", "rk-setup-row");
                const label = createElement("label", null, "Bots: ");
                const select = createElement("select", "rk-bots");
                for (let i = 0; i <= state.settings.maxBots; i++) {
                    const option = createElement("option", null, String(i));
                    option.value = String(i);
                    select.append(option);
                }
                select.value = String(state.settings.bots);
                select.addEventListener("change", () => ctx.sendAction({ type: "settings", bots: Number(select.value) }));
                label.append(select);
                const startButton = createElement("button", "rk-start", "Runde starten");
                startButton.addEventListener("click", () => ctx.sendAction({ type: "start" }));
                row.append(label, startButton);
                box.append(row);
            } else {
                box.append(createElement("p", "rk-muted", `Bots: ${state.settings.bots} · Warte auf den Host …`));
            }
        } else {
            const winner = state.players[state.winner];
            box.append(createElement("h3", null, winner ? `🏆 ${winner.name} gewinnt!` : "Runde beendet"));
            const list = createElement("ol", "rk-final");
            const sorted = [...state.players].sort((a, b) => b.cells - a.cells);
            for (const player of sorted) {
                const share = state.landCells ? Math.round((player.cells / state.landCells) * 100) : 0;
                list.append(createElement("li", null, `${player.name} – ${share} %`));
            }
            box.append(list);
            if (host) {
                const button = createElement("button", "rk-new-round", "Neue Runde");
                button.addEventListener("click", () => ctx.sendAction({ type: "new-round" }));
                box.append(button);
            } else {
                box.append(createElement("p", "rk-muted", "Der Host kann eine neue Runde starten."));
            }
        }

        overlay.replaceChildren(box);
    }

    function render() {
        if (!state) return;
        root.dataset.phase = state.phase;
        drawMap();
        renderStats();
        renderRanking();
        renderBanner();
        renderOverlay();
        sliderLabel.hidden = state.phase !== "running";
    }

    // Größe ändert sich (Leisten ein-/ausgeklappt, Fenster) → Beschriftung neu skalieren.
    let lastWidth = 0;
    const resizeObserver = new ResizeObserver(() => {
        if (state && canvas.clientWidth !== lastWidth) {
            lastWidth = canvas.clientWidth;
            drawMap();
        }
    });
    resizeObserver.observe(canvas);

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            state = newState;
            render();
        },
        destroy() {
            resizeObserver.disconnect();
            frame.remove();
        }
    };
}
