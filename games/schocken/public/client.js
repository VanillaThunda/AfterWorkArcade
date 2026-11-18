/**
 * Schocken – Client-Teil.
 *
 * Reines DOM/CSS (kein Canvas, keine Animationsschleife): Die Oberfläche wird
 * nur bei update() neu aufgebaut. Würfel bestehen aus CSS-Augen, eine kurze
 * CSS-Animation läuft nur für frisch geworfene Würfel; der Zugtimer ist eine
 * CSS-Animation mit passender Restdauer.
 *
 * Würfel unter einem geschlossenen Becher kommen vom Server als 0 an
 * (viewFor) – auch die eigenen – und werden als verdeckter Würfel "?"
 * dargestellt. Erst "Aufdecken" zeigt sie, und zwar allen.
 *
 * Aktionen:  roll {aside}, look, turn-sixes, finish, settings, start, new-match
 * Alle Texte per textContent – nie innerHTML (Schutz vor XSS).
 */

export const stylesheets = ["style.css"];

/** Augen-Positionen im 3×3-Raster (1 = oben links … 9 = unten rechts). */
const PIPS = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
};

const STAGE_LABELS = { half1: "1. Hälfte", half2: "2. Hälfte", finale: "Finale" };

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/** Ein Würfel. value 0 = verdeckt (im Becher). */
function createDie(value, { aside = false, selected = false, small = false } = {}) {
    const die = createElement("div", "sk-die");
    if (small) die.classList.add("sk-die-small");
    if (aside) die.classList.add("sk-aside");
    if (selected) die.classList.add("sk-selected");
    if (!value) {
        die.classList.add("sk-hidden");
        die.textContent = "?";
        die.setAttribute("aria-label", "verdeckter Würfel");
        return die;
    }
    die.setAttribute("aria-label", `Würfel ${value}`);
    for (const position of PIPS[value]) {
        const pip = createElement("i");
        pip.style.gridRow = String(Math.ceil(position / 3));
        pip.style.gridColumn = String(((position - 1) % 3) + 1);
        die.append(pip);
    }
    return die;
}

/** Laufender Zeitbalken (CSS-Animation, startet mit der Restzeit). */
function createTimer(remainingMs, totalMs) {
    const bar = createElement("div", "sk-timer");
    const fill = createElement("div", "sk-timer-fill");
    fill.style.animationDuration = `${totalMs}ms`;
    fill.style.animationDelay = `${-(totalMs - remainingMs)}ms`;
    bar.append(fill);
    return bar;
}

function throwLimit(round) {
    if (round.laden) return 1;
    return round.maxThrows ?? 3;
}

function canTurnSixes(round, turn) {
    if (!turn || turn.throws === 0 || !turn.open || turn.turned || turn.mustRoll) return false;
    if (turn.throws >= throwLimit(round)) return false;
    return turn.dice.filter((value, i) => !turn.aside[i] && value === 6).length >= 2;
}

/** Kurzfassung der Regeln unter dem Spielfeld (einmalig aufgebaut). */
function createRules() {
    const details = createElement("details", "sk-rules");
    details.open = true;
    details.append(createElement("summary", null, "Regeln kurz & knapp"));

    const grid = createElement("div", "sk-rules-grid");

    const flow = createElement("div");
    flow.append(createElement("h5", null, "Ablauf"));
    const flowList = createElement("ul");
    for (const text of [
        "Reihum bis zu 3 Würfe. Der Erste gibt Wurfzahl und Spielweise vor – niemand darf danach öfter werfen. Deckt der Erste auf, müssen alle anderen am Ende ihres Zugs ebenfalls aufdecken.",
        "Nach dem Wurf bleibt der Becher zu – auch du kennst deine Würfel nicht. Aufdecken zeigt sie allen; blind beenden ist erlaubt.",
        "Nur aufgedeckte Einsen dürfen herausgelegt werden (anklicken). Sie liegen offen und werden nicht mehr gewürfelt.",
        "Zwei aufgedeckte Sechsen → eine Eins (drei Sechsen → zwei Einsen). Nicht im letzten Wurf; die übrige Sechs muss neu.",
        "General und Straße zählen nur aus einem Wurf mit allen 3 Würfeln. Ein Schock darf gebaut werden.",
        "Zum Start wird geladen: Jeder würfelt genau einmal. 30 s Zeit pro Zug."
    ]) flowList.append(createElement("li", null, text));
    flow.append(flowList);

    const ranking = createElement("div");
    ranking.append(createElement("h5", null, "Rangfolge (höchster zuerst)"));
    const table = createElement("table", "sk-rules-table");
    const head = createElement("tr");
    head.append(createElement("th", null, "Wurf"), createElement("th", null, "Beispiel"), createElement("th", null, "Deckel"));
    table.append(head);
    for (const [name, example, chips] of [
        ["Schock Aus", "1-1-1", "alle"],
        ["Schock 6 … 2", "1-1-6 … 1-1-2", "6 … 2"],
        ["General", "6-6-6 … 2-2-2", "3"],
        ["Straße", "4-5-6 … 1-2-3", "2"],
        ["Zahlen", "z. B. 6-5-3", "1"]
    ]) {
        const row = createElement("tr");
        row.append(createElement("td", null, name), createElement("td", null, example), createElement("td", null, chips));
        table.append(row);
    }
    ranking.append(table);
    ranking.append(createElement("p", "sk-rules-note",
        "Gleichstand: weniger Würfe gewinnt, danach wer früher dran war."));

    const chips = createElement("div");
    chips.append(createElement("h5", null, "Deckel"));
    const chipList = createElement("ul");
    for (const text of [
        "Der beste Wurf bestimmt die Anzahl, der schlechteste Wurf bekommt sie.",
        "Erst aus dem Topf (13 Deckel), danach gibt der Beste seine Deckel ab.",
        "Ist der Topf leer, spielt nur noch mit, wer Deckel hat.",
        "Wer alle 13 Deckel hat, verliert die Hälfte. Der Rundenverlierer beginnt die nächste Runde.",
        "Komplett: zwei Hälften – verlieren zwei verschiedene Spieler, entscheidet ein Finale zwischen ihnen."
    ]) chipList.append(createElement("li", null, text));
    chips.append(chipList);

    grid.append(flow, ranking, chips);
    details.append(grid);
    return details;
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "sk-root"); // Bezugsrahmen für Container-Queries
    const root = createElement("div", "sk");
    const table = createElement("div", "sk-table");
    const head = createElement("div", "sk-head");
    const status = createElement("div", "sk-status");
    const pot = createElement("div", "sk-pot");
    head.append(status, pot);
    const seats = createElement("div", "sk-seats");
    const reveal = createElement("div", "sk-reveal");
    const overlay = createElement("div", "sk-overlay");
    table.append(head, reveal, seats, overlay);

    const panel = createElement("div", "sk-panel");
    const log = createElement("ul", "sk-log");

    root.append(table, panel, log, createRules());
    frame.append(root);
    container.append(frame);

    let state = null;
    let busy = false;
    let selected = new Set();   // eigene Würfel, die beim nächsten Wurf herausgelegt werden
    let selectionKey = "";
    let overlayKey = "";
    let initialRender = true;   // beim ersten Zeichnen (z. B. nach Reload) nichts animieren

    /**
     * Startzeiten der Würfel-Animationen. Die Oberfläche wird oft kurz
     * hintereinander neu aufgebaut (Antwort auf den Klick, Bot-Züge …). Damit
     * eine laufende Animation dabei nicht abbricht, merkt sich jede Animation
     * ihren Start; neu erzeugte Würfel setzen sie per negativem
     * animation-delay genau an der richtigen Stelle fort.
     */
    const animationStarts = new Map();
    const ANIMATION_MS = 1100;   // länger als die längste Würfel-Animation
    const STAGGER_MS = 90;       // Versatz zwischen den Würfeln

    /** Millisekunden seit Start der Animation `key` – oder null, wenn keine läuft. */
    function animationElapsed(key) {
        const now = performance.now();
        if (!animationStarts.has(key)) {
            animationStarts.set(key, initialRender ? -Infinity : now);
            if (animationStarts.size > 300) animationStarts.delete(animationStarts.keys().next().value);
        }
        const elapsed = now - animationStarts.get(key);
        return elapsed < ANIMATION_MS ? elapsed : null;
    }

    /**
     * Versieht die Würfel (Elemente) eines Spielers mit der passenden Animation:
     * nach einem Wurf springen/drehen sich verdeckte Würfel ("sk-tumble"),
     * offene rollen aus ("sk-rolling"); beim Aufdecken klappen sie um ("sk-flip").
     */
    function animateDice(id, turn, dieElements) {
        if (!turn || turn.throws === 0) return;
        const base = `${state.matchNumber}|${state.round.number}|${id}|${turn.throws}`;
        const rollElapsed = animationElapsed(`${base}|roll`);
        const flipElapsed = turn.open ? animationElapsed(`${base}|open`) : null;

        let k = 0;
        dieElements.forEach((die, i) => {
            if (turn.aside[i]) return;
            if (rollElapsed !== null) {
                die.classList.add(die.classList.contains("sk-hidden") ? "sk-tumble" : "sk-rolling");
                die.style.animationDelay = `${k * STAGGER_MS - rollElapsed}ms`;
            } else if (flipElapsed !== null) {
                die.classList.add("sk-flip");
                die.style.animationDelay = `${-flipElapsed}ms`;
            }
            k++;
        });
    }

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const nameOf = id => state.participants.find(p => p.id === id)?.name ?? "?";

    async function send(action) {
        if (busy) return;
        busy = true;
        render();
        await ctx.sendAction(action); // Fehler zeigt das Lobby-System als Hinweis an
        busy = false;
        render(); // alle Buttons (auch "Weiter" in der Auswertung) wieder freigeben
    }

    // --- Darstellung ---------------------------------------------------------

    function renderStatus() {
        const { match, round } = state;
        if (state.phase !== "playing" && state.phase !== "finished") {
            status.textContent = "Schocken";
            pot.hidden = true;
            return;
        }
        const parts = [STAGE_LABELS[match.stage] ?? ""];
        if (round) {
            parts.push(round.laden ? "Laden (1 Wurf)" : `Runde ${round.number}`);
            if (round.firstOpen !== null && round.firstOpen !== undefined) {
                const style = round.firstOpen ? "aufgedeckt" : "verdeckt";
                parts.push(round.laden ? `Vorgabe: ${style}` : `Vorgabe: ${round.maxThrows} ${round.maxThrows === 1 ? "Wurf" : "Würfe"} · ${style}`);
            } else if (!round.laden) {
                parts.push("Vorgabe offen");
            }
        }
        status.textContent = parts.filter(Boolean).join(" · ");

        pot.hidden = false;
        pot.replaceChildren(
            createElement("span", "sk-pot-label", "Topf"),
            createChipStack(match.pot),
            createElement("strong", null, String(match.pot))
        );
    }

    function createChipStack(count) {
        const stack = createElement("span", "sk-chips");
        for (let i = 0; i < Math.min(count, state.totalChips); i++) stack.append(createElement("i"));
        stack.setAttribute("aria-label", `${count} Deckel`);
        return stack;
    }

    function renderSeats() {
        if (!state.match) {
            seats.replaceChildren();
            return;
        }
        const round = state.round;
        const currentId = round && round.stage === "turns" ? round.order[round.turnIndex] : null;
        const revealEntries = state.reveal && round?.stage === "reveal" ? state.reveal : null;

        const cards = state.participants.map(p => {
            const card = createElement("div", "sk-seat");
            const inMatch = state.match.active.includes(p.id) && !p.left;
            const turn = round?.turns[p.id];
            if (p.id === ctx.me.id) card.classList.add("sk-seat-me");
            if (p.id === currentId) card.classList.add("sk-seat-active");
            if (!inMatch || p.left) card.classList.add("sk-seat-out");
            if (revealEntries?.bestId === p.id) card.classList.add("sk-seat-best");
            if (revealEntries?.loserId === p.id) card.classList.add("sk-seat-loser");

            // Kopfzeile: Name, Markierung, Deckel
            const top = createElement("div", "sk-seat-top");
            const name = createElement("span", "sk-seat-name", (p.bot ? "🤖 " : "") + p.name + (p.id === ctx.me.id ? " (du)" : ""));
            top.append(name);
            if (p.marker) {
                const marker = createElement("span", "sk-marker", "M");
                marker.title = "Markierungsdeckel: Verlierer der 1. Hälfte";
                top.append(marker);
            }
            const chips = createElement("span", "sk-seat-chips");
            chips.append(createChipStack(p.chips), createElement("strong", null, String(p.chips)));
            top.append(chips);
            card.append(top);

            // Würfel und Status
            const diceRow = createElement("div", "sk-seat-dice");
            const info = createElement("div", "sk-seat-info");

            if (p.left) {
                info.textContent = "hat das Spiel verlassen";
            } else if (!inMatch) {
                info.textContent = "Zuschauer im Finale";
            } else if (!turn) {
                info.textContent = round ? "diese Runde raus (keine Deckel)" : "";
            } else {
                if (turn.throws > 0) {
                    const dieElements = turn.dice.map((value, i) => createDie(value, { aside: turn.aside[i], small: true }));
                    animateDice(p.id, turn, dieElements);
                    diceRow.append(...dieElements);
                }
                const cup = turn.result ? turn.result.label : "Becher zu 🥤";
                if (turn.done) {
                    const label = turn.result ? turn.result.label : "verdeckt 🥤";
                    info.textContent = `${label} · ${turn.throws} ${turn.throws === 1 ? "Wurf" : "Würfe"}`;
                } else if (p.id === currentId) {
                    info.textContent = turn.throws === 0 ? "ist am Zug …" : `${turn.throws}. Wurf · ${cup}`;
                    if (round.turnRemainingMs != null) card.append(createTimer(round.turnRemainingMs, state.turnMs));
                } else {
                    info.textContent = "wartet";
                }
            }

            card.append(diceRow, info);
            return card;
        });
        seats.replaceChildren(...cards);
    }

    function renderReveal() {
        const show = state.round?.stage === "reveal" && state.reveal;
        reveal.hidden = !show;
        if (!show) return;

        const box = createElement("div", "sk-reveal-box");
        // Einblend-Animation nur beim ersten Anzeigen, nicht bei jedem "Weiter"-Klick
        const key = `${state.matchNumber}|${state.round.number}`;
        if (reveal.dataset.key !== key) box.classList.add("sk-pop");
        reveal.dataset.key = key;
        box.append(createElement("h4", null, "Auswertung"));
        const list = createElement("ol", "sk-reveal-list");
        for (const entry of state.reveal.entries) {
            const item = createElement("li");
            if (entry.id === state.reveal.bestId) item.classList.add("sk-best");
            if (entry.id === state.reveal.loserId) item.classList.add("sk-loser");
            const dice = createElement("span", "sk-reveal-dice");
            for (const value of [...entry.dice].sort((a, b) => b - a)) dice.append(createDie(value, { small: true }));
            item.append(
                createElement("span", "sk-reveal-name", entry.name),
                dice,
                createElement("span", "sk-reveal-label", `${entry.label} (${entry.throws})`)
            );
            list.append(item);
        }
        box.append(list, createElement("p", "sk-reveal-text", state.reveal.text));
        if (state.reveal.halfLoserId && state.phase === "playing") {
            box.append(createElement("p", "sk-reveal-half", `${nameOf(state.reveal.halfLoserId)} hat alle Deckel – die Hälfte ist vorbei!`));
        }

        // "Weiter": ab 75 % der Spieler geht es sofort weiter, sonst nach Ablauf des Timers.
        if (state.phase === "playing") {
            const humans = state.participants.filter(p => !p.bot && !p.left);
            const acks = state.reveal.acks ?? [];
            const needed = Math.max(1, Math.ceil(humans.length * 0.75));
            const footer = createElement("div", "sk-reveal-footer");

            const ready = createElement("div", "sk-reveal-ready");
            for (const human of humans) {
                const chip = createElement("span", acks.includes(human.id) ? "sk-ready sk-ready-yes" : "sk-ready",
                    `${acks.includes(human.id) ? "✓ " : ""}${human.name}`);
                ready.append(chip);
            }

            const amPlayer = humans.some(h => h.id === ctx.me.id);
            const iAcked = acks.includes(ctx.me.id);
            const seconds = Math.ceil((state.revealRemainingMs ?? 0) / 1000);
            if (amPlayer && !iAcked) {
                const button = createElement("button", "sk-continue", `Weiter (${acks.length}/${needed})`);
                button.disabled = busy;
                button.addEventListener("click", () => send({ type: "continue" }));
                footer.append(button);
            } else {
                footer.append(createElement("span", "sk-muted", amPlayer ? `Warte auf die anderen … (${acks.length}/${needed})` : `${acks.length}/${needed} bereit`));
            }
            footer.append(createElement("span", "sk-muted sk-reveal-seconds", `sonst automatisch nach ${seconds} s`));
            box.append(ready, footer);
            if (state.revealRemainingMs != null) box.append(createTimer(state.revealRemainingMs, state.revealMs ?? 30000));
        }
        reveal.replaceChildren(box);
    }

    function renderOverlay() {
        const host = isHost();
        const key = [state.phase, host, state.settings.bots, state.settings.mode, state.members.length, state.result?.text].join("|");
        if (key === overlayKey) return;
        overlayKey = key;

        overlay.hidden = state.phase !== "setup" && state.phase !== "finished";
        if (overlay.hidden) return;

        const box = createElement("div", "sk-overlay-box");
        if (state.phase === "setup") {
            box.append(createElement("h3", null, "🎲 Schocken"));
            box.append(createElement("p", "sk-muted",
                "Würfle möglichst hoch – der schlechteste Wurf jeder Runde kassiert Deckel. Wer alle 13 Deckel hat, verliert."));
            box.append(createElement("p", null, `Mitspieler: ${state.members.map(m => m.name).join(", ")}`));

            if (host) {
                const form = createElement("div", "sk-setup");
                const botLabel = createElement("label", null, "Bots ");
                const botSelect = createElement("select", "sk-bots");
                const maxBots = Math.min(state.settings.maxBots, Math.max(0, 8 - state.members.length));
                for (let i = 0; i <= maxBots; i++) {
                    const option = createElement("option", null, String(i));
                    option.value = String(i);
                    botSelect.append(option);
                }
                botSelect.value = String(Math.min(state.settings.bots, maxBots));
                botSelect.addEventListener("change", () => ctx.sendAction({ type: "settings", bots: Number(botSelect.value) }));
                botLabel.append(botSelect);

                const modeLabel = createElement("label", null, "Umfang ");
                const modeSelect = createElement("select", "sk-mode");
                for (const [value, text] of [["full", "Komplett (2 Hälften + Finale)"], ["half", "Eine Hälfte"]]) {
                    const option = createElement("option", null, text);
                    option.value = value;
                    modeSelect.append(option);
                }
                modeSelect.value = state.settings.mode;
                modeSelect.addEventListener("change", () => ctx.sendAction({ type: "settings", mode: modeSelect.value }));
                modeLabel.append(modeSelect);

                const start = createElement("button", "sk-start", "Partie starten");
                start.addEventListener("click", () => ctx.sendAction({ type: "start" }));
                form.append(botLabel, modeLabel, start);
                box.append(form);
            } else {
                box.append(createElement("p", "sk-muted",
                    `Bots: ${state.settings.bots} · ${state.settings.mode === "full" ? "Komplett" : "Eine Hälfte"} · Warte auf den Host …`));
            }
        } else {
            box.append(createElement("h3", null, state.result?.loserName ? `🍺 ${state.result.loserName} verliert!` : "Partie beendet"));
            box.append(createElement("p", null, state.result?.text ?? ""));
            if (host) {
                const again = createElement("button", "sk-new-match", "Neue Partie");
                again.addEventListener("click", () => ctx.sendAction({ type: "new-match" }));
                box.append(again);
            } else {
                box.append(createElement("p", "sk-muted", "Der Host kann eine neue Partie starten."));
            }
        }
        overlay.replaceChildren(box);
    }

    function renderPanel() {
        const round = state?.round;
        const myTurn = round?.turns?.[ctx.me.id];
        panel.hidden = !(state?.phase === "playing" && myTurn);
        if (panel.hidden) return;

        const isMyTurn = round.stage === "turns" && round.order[round.turnIndex] === ctx.me.id;
        const limit = throwLimit(round);
        // Hat der Erste aufgedeckt, müssen alle anderen beim Beenden aufdecken.
        const mustReveal = round.firstOpen === true && round.turnIndex > 0;

        // Auswahl zurücksetzen, sobald ein neuer Wurf vorliegt.
        const key = `${state.matchNumber}|${round.number}|${myTurn.throws}|${myTurn.aside.join()}`;
        if (key !== selectionKey) {
            selectionKey = key;
            selected = new Set();
        }

        const dice = createElement("div", "sk-panel-dice");
        if (myTurn.throws === 0) {
            for (let i = 0; i < 3; i++) dice.append(createDie(0));
        } else {
            myTurn.dice.forEach((value, i) => {
                const die = createDie(value, { aside: myTurn.aside[i], selected: selected.has(i) });
                // Herauslegen: nur aufgedeckte Einsen, und nur wenn noch ein Wurf folgt.
                const canSelect = isMyTurn && myTurn.open && value === 1 && !myTurn.aside[i]
                    && myTurn.throws < limit && !busy;
                if (canSelect) {
                    die.classList.add("sk-clickable");
                    die.tabIndex = 0;
                    die.setAttribute("role", "button");
                    die.title = selected.has(i) ? "zurück in den Becher" : "Eins herauslegen";
                    const toggle = () => {
                        if (selected.has(i)) selected.delete(i); else selected.add(i);
                        renderPanel();
                    };
                    die.addEventListener("click", toggle);
                    die.addEventListener("keydown", event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggle();
                        }
                    });
                }
                dice.append(die);
            });
        }
        // Animationen im eigenen Bereich: Wurf bzw. Aufdecken (laufen über Neuaufbauten hinweg weiter)
        animateDice(ctx.me.id, myTurn, [...dice.children]);

        const info = createElement("div", "sk-panel-info");
        const titleText = myTurn.result ? myTurn.result.label
            : myTurn.throws > 0 ? "Becher zu 🥤"
            : isMyTurn ? "Du bist dran!" : "Dein Becher";
        info.append(createElement("strong", null, titleText));
        let hint = "";
        if (isMyTurn) {
            const hasOnes = myTurn.dice.some((value, i) => value === 1 && !myTurn.aside[i]);
            if (myTurn.throws === 0) hint = round.laden ? "Laden: ein Wurf für alle." : `Bis zu ${limit} ${limit === 1 ? "Wurf" : "Würfe"}.`;
            else if (myTurn.mustRoll) hint = "Sechsen gedreht – die übrigen Würfel müssen neu geworfen werden.";
            else if (!myTurn.open && mustReveal) hint = myTurn.throws >= limit
                ? "Letzter Wurf – der Erste hat aufgedeckt, also deckst du beim Beenden auch auf."
                : "Becher zu – aufdecken oder blind weiter? Beim Beenden musst du aufdecken (Vorgabe).";
            else if (!myTurn.open) hint = myTurn.throws >= limit
                ? "Letzter Wurf – aufdecken (alle sehen es) oder verdeckt beenden?"
                : "Becher zu – aufdecken (alle sehen es), blind weiterwürfeln oder verdeckt beenden?";
            else if (myTurn.throws >= limit) hint = "Letzter Wurf – Zug beenden.";
            else hint = hasOnes
                ? `Wurf ${myTurn.throws}/${limit}. Einsen anklicken zum Herauslegen.`
                : `Wurf ${myTurn.throws}/${limit}. Weiterwürfeln oder Zug beenden.`;
        } else if (myTurn.done) {
            hint = myTurn.open ? "Fertig – aufgedeckt." : "Fertig – dein Becher bleibt zu.";
        } else {
            hint = "Warte, bis du an der Reihe bist.";
        }
        info.append(createElement("span", "sk-muted", hint));

        const buttons = createElement("div", "sk-panel-buttons");
        if (isMyTurn) {
            const openCount = myTurn.aside.filter(a => !a).length - selected.size;
            const rollButton = createElement("button", "sk-roll",
                myTurn.throws === 0 ? "🎲 Würfeln" : `🎲 ${openCount} Würfel werfen (${myTurn.throws + 1}/${limit})`);
            rollButton.disabled = busy || myTurn.throws >= limit || openCount < 1;
            rollButton.addEventListener("click", () => send({ type: "roll", aside: [...selected] }));
            buttons.append(rollButton);

            if (myTurn.throws > 0 && !myTurn.open) {
                const lookButton = createElement("button", "sk-look button-secondary", "👀 Aufdecken");
                lookButton.title = "Unter den Becher schauen – alle Mitspieler sehen deine Würfel";
                lookButton.disabled = busy;
                lookButton.addEventListener("click", () => send({ type: "look" }));
                buttons.append(lookButton);
            }

            if (canTurnSixes(round, myTurn)) {
                const turnButton = createElement("button", "sk-turn button-secondary", "6 → 1 Sechsen drehen");
                turnButton.disabled = busy;
                turnButton.addEventListener("click", () => send({ type: "turn-sixes" }));
                buttons.append(turnButton);
            }

            const finishButton = createElement("button", "sk-finish button-secondary",
                myTurn.throws === 0 || myTurn.open ? "✋ Zug beenden"
                    : mustReveal ? "✋ Beenden & aufdecken" : "✋ Verdeckt beenden");
            finishButton.disabled = busy || myTurn.throws === 0 || myTurn.mustRoll;
            finishButton.addEventListener("click", () => send({ type: "finish" }));
            buttons.append(finishButton);
        }

        const children = [dice, info, buttons];
        if (isMyTurn && round.turnRemainingMs != null) children.push(createTimer(round.turnRemainingMs, state.turnMs));
        panel.replaceChildren(...children);
    }

    function renderLog() {
        log.hidden = state.log.length === 0;
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
    }

    function render() {
        if (!state) return;
        root.dataset.phase = state.phase;
        renderStatus();
        renderSeats();
        renderReveal();
        renderOverlay();
        renderPanel();
        renderLog();
        initialRender = false;
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(newState) {
            state = newState;
            if (!state) return;
            render();
        },
        destroy() {
            frame.remove();
        }
    };
}
