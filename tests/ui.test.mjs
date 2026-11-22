/**
 * UI-Test im echten Browser (headless Edge oder Chrome).
 *
 * Simuliert zwei Spieler in getrennten Browser-Kontexten (eigener
 * localStorage) und klickt sich durch Login, Chat, Lobbys und den
 * Eroberungs-Würfel. Gesteuert wird der Browser über das Chrome DevTools
 * Protocol (CDP) – ohne npm-Pakete.
 *
 * Voraussetzung: Microsoft Edge, Google Chrome oder Chromium ist installiert.
 * Eigener Pfad per Umgebungsvariable:  BROWSER_PATH=/pfad/zum/browser
 *
 * Start:     npm run test:ui   bzw.  node tests/ui.test.mjs
 * Ergebnis:  Screenshots unter tests/output/
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, createTestRunner, sleep } from "./helpers.mjs";

const SERVER_PORT = 3459;
const DEBUG_PORT = 9333;
const OUTPUT_DIR = fileURLToPath(new URL("./output/", import.meta.url));

// ===========================================================================
// Browser finden und starten
// ===========================================================================

const BROWSER_CANDIDATES = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];

const browserPath = BROWSER_CANDIDATES.find(candidate => candidate && fs.existsSync(candidate));
if (!browserPath) {
    console.error("Kein Browser gefunden. Bitte Edge/Chrome installieren oder BROWSER_PATH setzen.");
    process.exit(1);
}

/** Startet den Browser headless und liefert die WebSocket-Adresse für CDP. */
async function launchBrowser() {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "awa-ui-test-"));
    const browser = spawn(browserPath, [
        "--headless=new",
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank"
    ]);

    // Der erste Start mit frischem Profil kann einige Sekunden dauern.
    for (let attempt = 0; attempt < 150; attempt++) {
        try {
            const info = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
            return { browser, profileDir, wsUrl: info.webSocketDebuggerUrl };
        } catch {
            await sleep(200);
        }
    }
    browser.kill();
    throw new Error("Browser hat den Debug-Port nicht geöffnet.");
}

// ===========================================================================
// Minimaler CDP-Client
// ===========================================================================

function createCdpClient(wsUrl) {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let nextId = 1;

    socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        } else {
            for (const listener of listeners) listener(message);
        }
    });

    return {
        ready: new Promise(resolve => socket.addEventListener("open", resolve)),
        send(method, params = {}, sessionId) {
            return new Promise((resolve, reject) => {
                const id = nextId++;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        },
        onEvent: listener => listeners.push(listener),
        close: () => socket.close()
    };
}

/** Erwartete Konsolenmeldungen (absichtlich provozierte 4xx-Antworten). */
const EXPECTED_CONSOLE = /status of 4\d\d/;
const consoleProblems = [];

/** Öffnet eine Seite in einem eigenen Browser-Kontext (= eigener Spieler). */
/** CDP-Angaben zu einer Taste (key, code, Windows-Tastencode). */
function keyInfo(key) {
    const codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, w: 87, a: 65, s: 83, d: 68, " ": 32 };
    const code = key === " " ? "Space" : key.length === 1 ? `Key${key.toUpperCase()}` : key;
    return { key, code, windowsVirtualKeyCode: codes[key] };
}

async function openPage(cdp, label) {
    const { browserContextId } = await cdp.send("Target.createBrowserContext");
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    for (const domain of ["Runtime", "Page", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);

    cdp.onEvent(message => {
        if (message.sessionId !== sessionId) return;
        const { method, params } = message;

        if (method === "Runtime.exceptionThrown") {
            consoleProblems.push(`[${label}] Exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
        } else if (method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(params.type)) {
            consoleProblems.push(`[${label}] console.${params.type}: ${params.args.map(a => a.value ?? a.description).join(" ")}`);
        } else if (method === "Log.entryAdded" && params.entry.level === "error" && !EXPECTED_CONSOLE.test(params.entry.text)) {
            consoleProblems.push(`[${label}] ${params.entry.text} ${params.entry.url ?? ""}`);
        }
    });

    const page = {
        /** Führt JavaScript in der Seite aus (Rückgabe per return). */
        async eval(code) {
            const result = await cdp.send("Runtime.evaluate", {
                expression: `(async () => { ${code} })()`,
                awaitPromise: true,
                returnByValue: true
            }, sessionId);
            if (result.exceptionDetails) {
                throw new Error(`[${label}] ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
            }
            return result.result.value;
        },
        async goto(url) {
            await cdp.send("Page.navigate", { url }, sessionId);
            await sleep(800);
        },
        /** Wartet, bis ein JavaScript-Ausdruck wahr ist. */
        async waitFor(expression, description, timeout = 5000) {
            const end = Date.now() + timeout;
            while (Date.now() < end) {
                if (await page.eval(`return Boolean(${expression});`)) return;
                await sleep(100);
            }
            throw new Error(`[${label}] Timeout: ${description}`);
        },
        viewport: (width, height) => cdp.send("Emulation.setDeviceMetricsOverride",
            { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId),
        async screenshot(name) {
            const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
            fs.writeFileSync(path.join(OUTPUT_DIR, name), Buffer.from(data, "base64"));
        },
        text: selector => page.eval(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null;`),
        visible: selector => page.eval(`const e = document.querySelector(${JSON.stringify(selector)}); return !!e && e.offsetParent !== null;`),
        fill: (selector, value) => page.eval(`
            const e = document.querySelector(${JSON.stringify(selector)});
            e.value = ${JSON.stringify(value)};
            e.dispatchEvent(new Event("input", { bubbles: true }));`),
        submit: selector => page.eval(`document.querySelector(${JSON.stringify(selector)}).requestSubmit();`),
        click: selector => page.eval(`document.querySelector(${JSON.stringify(selector)}).click();`),
        clickText: (selector, text) => page.eval(`
            [...document.querySelectorAll(${JSON.stringify(selector)})]
                .find(e => e.textContent.trim() === ${JSON.stringify(text)}).click();`),
        /** Echter Tastendruck über CDP (landet beim fokussierten Element). */
        async press(key) {
            await page.keyDown(key);
            await page.keyUp(key);
        },
        /** Taste nur drücken bzw. nur loslassen (für „Taste halten“). */
        keyDown: key => cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...keyInfo(key), text: key.length === 1 ? key : undefined }, sessionId),
        keyUp: key => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...keyInfo(key) }, sessionId)
    };

    await page.viewport(1400, 1000);
    return page;
}

// ===========================================================================
// Testablauf
// ===========================================================================

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
console.log(`Browser: ${browserPath}`);

const server = await startServer(SERVER_PORT, { HOST: "127.0.0.1" });
const APP = server.baseUrl;
const { browser, profileDir, wsUrl } = await launchBrowser();
const cdp = createCdpClient(wsUrl);
await cdp.ready;

const { test, section, summary } = createTestRunner();
const anna = await openPage(cdp, "Anna");
const ben = await openPage(cdp, "Ben");

section("Anmeldung und globaler Chat");

await test("Login-Ansicht wird angezeigt", async () => {
    await anna.goto(APP);
    await ben.goto(APP);
    assert.ok(await anna.visible("#view-login"));
    assert.equal(await anna.visible("#sidebar"), false);
    await anna.screenshot("01-login.png");
});
await test("Login Anna und Ben", async () => {
    await anna.fill("#login-name", "Anna");
    await anna.submit("#login-form");
    await anna.waitFor(`!document.getElementById("view-overview").hidden`, "Übersicht");
    await ben.fill("#login-name", "Ben");
    await ben.submit("#login-form");
    await ben.waitFor(`!document.getElementById("view-overview").hidden`, "Übersicht");
    await anna.waitFor(`document.getElementById("online-count").textContent === "2"`, "2 online");
    assert.equal(await anna.text("#current-user-name"), "Anna");
    assert.match(await anna.text("#app-version"), /^v\d+\.\d+\.\d+$/);
});
await test("Doppelter Name zeigt Fehlermeldung", async () => {
    const duplicate = await openPage(cdp, "Doppelt");
    await duplicate.goto(APP);
    await duplicate.fill("#login-name", "anna");
    await duplicate.submit("#login-form");
    await duplicate.waitFor(`document.getElementById("login-error").textContent.includes("vergeben")`, "Fehlermeldung");
});
await test("Globaler Chat (HTML wird als Text angezeigt)", async () => {
    await anna.fill("#global-chat-input", "Hallo <b>Welt</b>");
    await anna.submit("#global-chat-form");
    await ben.waitFor(`document.querySelector("#global-chat-messages .chat-text")?.textContent === "Hallo <b>Welt</b>"`, "Chat bei Ben");
    assert.equal(await ben.eval(`return document.querySelector("#global-chat-messages b") === null;`), true);
    assert.equal(await anna.eval(`return document.querySelector("#global-chat-messages .chat-message-own") !== null;`), true);
    await anna.screenshot("02-uebersicht.png");
});

/** Helligkeit (0–255) der berechneten Hintergrundfarbe eines Elements. */
const brightness = (page, selector) => page.eval(`
    const m = getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor.match(/[\\d.]+/g).map(Number);
    return Math.round(0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]);`);
const theme = page => page.eval(`return document.documentElement.dataset.theme;`);
/** Schaltet per Button auf das gewünschte Design. */
async function setTheme(page, wanted) {
    if (await theme(page) !== wanted) await page.click("#theme-toggle");
    assert.equal(await theme(page), wanted);
}

await test("Dark-Mode: Schalter wechselt das Design und bleibt nach dem Neuladen erhalten", async () => {
    const initial = await theme(anna);
    await setTheme(anna, "light");
    await sleep(300); // Farbübergang
    const light = await brightness(anna, "body");
    assert.ok(light > 200, `hell (Start: ${initial}, Helligkeit ${light})`);
    assert.equal(await anna.text("#theme-toggle"), "🌙");
    await anna.click("#theme-toggle");
    assert.equal(await theme(anna), "dark");
    assert.equal(await anna.eval(`return document.getElementById("theme-toggle").getAttribute("aria-pressed");`), "true");
    await sleep(300); // Farbübergang
    assert.ok(await brightness(anna, "body") < 60, "Hintergrund dunkel");
    assert.ok(await brightness(anna, "#global-chat-input") < 60, "Eingabefeld dunkel");
    await anna.screenshot("12-darkmode.png");

    await anna.goto(APP);
    await anna.waitFor(`!document.getElementById("view-overview").hidden`, "Übersicht nach Reload");
    assert.equal(await theme(anna), "dark", "nach Reload weiterhin dunkel");
    assert.equal(await anna.text("#theme-toggle"), "☀️");
    await setTheme(anna, "light");
    await sleep(300);
    assert.ok(await brightness(anna, "body") > 200, "wieder hell");
});

section("Lobbys");

await test("Passwortfelder verdeckt, aber kein Browser-Passwortfeld (kein Speichern-Dialog)", async () => {
    assert.equal(await anna.eval(`return document.querySelectorAll('input[type="password"]').length;`), 0);
    for (const id of ["create-lobby-password", "password-dialog-input"]) {
        const masked = await anna.eval(`return getComputedStyle(document.getElementById("${id}")).webkitTextSecurity;`);
        assert.equal(masked, "disc", `${id} verdeckt`);
        assert.equal(await anna.eval(`return document.getElementById("${id}").autocomplete;`), "off");
    }
});
await test("Anna erstellt offene Lobby mit Passwort", async () => {
    await anna.fill("#create-lobby-name", "Freitagsrunde");
    await anna.fill("#create-lobby-password", "geheim");
    await anna.submit("#create-lobby-form");
    await anna.waitFor(`!document.getElementById("view-lobby").hidden`, "Lobby-Ansicht");
    assert.equal(await anna.text("#lobby-name"), "Freitagsrunde");
    assert.equal(await anna.visible("#host-game-controls"), true);
    assert.equal(await anna.visible("#lobby-password-badge"), true);
    await ben.waitFor(`document.querySelectorAll("#lobby-list .lobby-item").length === 1`, "Lobby in Bens Liste");
    assert.match(await ben.text("#lobby-list .lobby-item"), /🔒 Freitagsrunde/);
    await ben.screenshot("03-lobbyliste.png");
});
await test("Ben tritt per Passwort-Dialog bei (erst falsch, dann richtig)", async () => {
    await ben.clickText("#lobby-list button", "Beitreten");
    await ben.waitFor(`document.getElementById("password-dialog").open`, "Dialog offen");
    await ben.fill("#password-dialog-input", "falsch");
    await ben.click('#password-dialog button[value="ok"]');
    await ben.waitFor(`document.querySelector(".toast-error")?.textContent.includes("Falsches Passwort")`, "Fehler-Hinweis");
    await ben.waitFor(`document.getElementById("password-dialog").open`, "Dialog erneut offen");
    await ben.fill("#password-dialog-input", "geheim");
    await ben.click('#password-dialog button[value="ok"]');
    await ben.waitFor(`!document.getElementById("view-lobby").hidden`, "Ben in Lobby");
    assert.equal(await ben.visible("#host-game-controls"), false);
    await anna.waitFor(`document.querySelectorAll("#member-list li").length === 2`, "2 Mitglieder");
    await anna.waitFor(`[...document.querySelectorAll("#lobby-chat-messages .chat-message-system")]
        .some(e => e.textContent.includes("Ben ist der Lobby beigetreten"))`, "Systemnachricht");
});
await test("Lobby-Chat erscheint nicht im globalen Chat", async () => {
    await ben.fill("#lobby-chat-input", "Moin aus der Lobby");
    await ben.submit("#lobby-chat-form");
    await anna.waitFor(`[...document.querySelectorAll("#lobby-chat-messages .chat-text")]
        .some(e => e.textContent === "Moin aus der Lobby")`, "Lobby-Chat bei Anna");
    assert.equal(await anna.eval(`return [...document.querySelectorAll("#global-chat-messages .chat-text")]
        .some(e => e.textContent === "Moin aus der Lobby");`), false);
});

section("Eroberungs-Würfel");

/** Startet ein Spiel über den Auswahl-Dialog („+ Spiel auswählen“ → Kachel → „Spiel starten“). */
async function startGame(page, gameId) {
    await page.click("#open-game-picker");
    await page.waitFor(`document.getElementById("game-picker").open`, "Spielauswahl offen");
    await page.click(`.game-tile[data-game-id="${gameId}"] .game-tile-select`);
    await page.click(".game-picker-start");
    await page.waitFor(`!document.getElementById("game-picker").open`, "Spielauswahl geschlossen");
}

await test("Spielauswahl-Dialog: Kacheln mit Bild, Titel und Beschreibung", async () => {
    assert.equal(await ben.visible("#open-game-picker"), false, "Mitspieler sieht den Button nicht");
    await anna.click("#open-game-picker");
    await anna.waitFor(`document.getElementById("game-picker").open`, "Dialog offen");
    assert.equal(await anna.eval(`return document.querySelectorAll(".game-tile").length;`), 9, "9 Spiele zur Auswahl");
    await anna.waitFor(`[...document.querySelectorAll(".game-tile img")].every(i => i.complete && i.naturalWidth > 0)
        && document.querySelectorAll(".game-tile img").length === 9`, "9 Vorschaubilder geladen");
    const tiles = await anna.eval(`return [...document.querySelectorAll(".game-tile")].map(t => ({
        title: t.querySelector(".game-tile-title").textContent,
        description: t.querySelector(".game-tile-description").textContent }));`);
    for (const tile of tiles) {
        assert.ok(tile.title.length > 0 && tile.description.length > 20, `Titel und Beschreibung: ${tile.title}`);
    }
    assert.equal(await anna.eval(`return document.querySelector(".game-picker-start").disabled;`), true, "Start ohne Auswahl gesperrt");

    // Auswahl wechselt: immer nur eine Kachel ausgewählt
    await anna.click('.game-tile[data-game-id="schocken"] .game-tile-select');
    await anna.click('.game-tile[data-game-id="revierkampf"] .game-tile-select');
    const pressed = await anna.eval(`return [...document.querySelectorAll('.game-tile-select[aria-pressed="true"]')]
        .map(b => b.closest(".game-tile").dataset.gameId);`);
    assert.deepEqual(pressed, ["revierkampf"], "nur Revierkampf ausgewählt");
    assert.equal(await anna.eval(`return document.querySelector(".game-picker-start").disabled;`), false, "Start freigegeben");
    assert.ok((await anna.text(".game-picker-selection")).includes("Revierkampf"), "Fußzeile nennt die Auswahl");

    const overflow = await anna.eval(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    assert.ok(overflow <= 0, `kein horizontales Scrollen (${overflow}px)`);
    await anna.screenshot("16-spielauswahl.png");
    await setTheme(anna, "dark");
    await sleep(300);
    assert.ok(await brightness(anna, ".game-picker") < 60, "Dialog dunkel");
    await anna.screenshot("17-spielauswahl-dunkel.png");
    await setTheme(anna, "light");

    // Abbrechen schließt, ohne ein Spiel zu starten; beim nächsten Öffnen ist nichts gewählt
    await anna.click('.game-picker [data-action="cancel"]');
    await anna.waitFor(`!document.getElementById("game-picker").open`, "Dialog geschlossen");
    assert.equal(await anna.text("#game-title"), "Kein Spiel ausgewählt");
    await anna.click("#open-game-picker");
    assert.equal(await anna.eval(`return document.querySelectorAll('.game-tile-select[aria-pressed="true"]').length;`), 0, "Auswahl zurückgesetzt");
    await anna.click('.game-picker [data-action="cancel"]');
});
await test("Spielauswahl bei kleinem Fenster und auf dem Handy: nichts abgeschnitten", async () => {
    for (const [width, height, shot] of [[1000, 560, "16b-spielauswahl-klein.png"], [390, 800, "16c-spielauswahl-mobil.png"]]) {
        await anna.viewport(width, height);
        await sleep(200);
        await anna.click("#open-game-picker");
        await anna.waitFor(`document.getElementById("game-picker").open`, "Dialog offen");
        await sleep(200);
        const check = await anna.eval(`
            const dialog = document.getElementById("game-picker").getBoundingClientRect();
            const start = document.querySelector(".game-picker-start").getBoundingClientRect();
            const tiles = [...document.querySelectorAll(".game-tile")];
            return {
                clipped: tiles.filter(t => t.scrollHeight > t.clientHeight + 1).map(t => t.dataset.gameId),
                buttonsTooSmall: tiles.filter(t => t.querySelector(".game-tile-select").offsetHeight < 30).map(t => t.dataset.gameId),
                dialogInside: dialog.left >= 0 && dialog.right <= innerWidth + 0.5 && dialog.top >= 0 && dialog.bottom <= innerHeight + 0.5,
                startInside: start.right <= innerWidth + 0.5 && start.bottom <= innerHeight + 0.5,
                gridScrolls: document.querySelector(".game-picker-grid").scrollHeight > document.querySelector(".game-picker-grid").clientHeight
            };`);
        assert.deepEqual(check.clipped, [], `${width}×${height}: Kacheln abgeschnitten`);
        assert.deepEqual(check.buttonsTooSmall, [], `${width}×${height}: Auswahl-Buttons zu klein`);
        assert.ok(check.dialogInside, `${width}×${height}: Dialog passt ins Fenster`);
        assert.ok(check.startInside, `${width}×${height}: „Spiel starten“ sichtbar`);
        assert.ok(check.gridScrolls, `${width}×${height}: Kacheln scrollen statt gestaucht zu werden`);
        await anna.screenshot(shot);
        await anna.click('.game-picker [data-action="cancel"]');
    }
    await anna.viewport(1400, 1000);
});
await test("Host startet Spiel → lädt bei beiden", async () => {
    await startGame(anna, "eroberungs-wuerfel");
    await anna.waitFor(`document.querySelector(".rw")`, "Spiel bei Anna");
    await ben.waitFor(`document.querySelector(".rw")`, "Spiel bei Ben");
    assert.equal(await anna.text("#game-title"), "Eroberungs-Würfel");
    assert.equal(await anna.visible("#end-game-button"), true);
    assert.equal(await ben.visible("#end-game-button"), false);
    assert.equal(await ben.eval(`return document.querySelectorAll(".rw-attacker .rw-buttons button").length;`), 3);
    assert.equal(await ben.eval(`return document.querySelectorAll(".rw-defender .rw-buttons button").length;`), 2);
    assert.equal(await anna.eval(`return document.querySelectorAll('link[href*="/games/eroberungs-wuerfel/style.css"]').length;`), 1);
});
/** Position und Größe eines Elements (für Layout-Prüfungen). */
const rectOf = (page, selector) => page.eval(`
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };`);

await test("Spielmodus: Lobby links, Spiel in der Mitte, Chats rechts", async () => {
    for (const page of [anna, ben]) {
        await page.waitFor(`document.querySelector(".layout").classList.contains("game-mode")`, "Spielmodus aktiv");
    }
    const game = await rectOf(anna, ".game-card");
    const members = await rectOf(anna, "#lobby-members-card");
    const lobbyChat = await rectOf(anna, "#lobby-chat-card");
    assert.ok(members.right <= game.left, "Mitglieder links vom Spiel");
    assert.ok(lobbyChat.left >= game.right, "Lobby-Chat rechts vom Spiel");
    assert.ok(game.height > 800, `Spiel nutzt die volle Höhe (${game.height}px)`);
    assert.equal(await anna.visible("#lobby-chat-input"), true, "Lobby-Chat bedienbar");
    assert.equal(await anna.visible("#global-chat-messages"), false, "globaler Chat standardmäßig eingeklappt");
    assert.equal(await anna.visible("#online-list"), false, "Online-Liste standardmäßig eingeklappt");
    const overflow = await anna.eval(`return document.documentElement.scrollHeight - document.documentElement.clientHeight;`);
    assert.ok(overflow <= 0, `Seite scrollt nicht vertikal (${overflow}px)`);
});
await test("Spielmodus: Leisten ein-/ausklappen", async () => {
    const before = await rectOf(anna, ".game-card");
    await anna.click('.dock-toggle[data-dock="left"]');
    await anna.click('.dock-toggle[data-dock="right"]');
    assert.equal(await anna.visible("#lobby-members-card"), false, "Mitglieder ausgeblendet");
    assert.equal(await anna.visible("#lobby-chat-card"), false, "Lobby-Chat ausgeblendet");
    const collapsed = await rectOf(anna, ".game-card");
    assert.ok(collapsed.width > before.width + 400, `Spiel breiter (${before.width} → ${collapsed.width}px)`);

    // Neue Nachricht bei eingeklappter Chat-Leiste → Hinweis-Punkt
    await ben.fill("#lobby-chat-input", "Gut gewürfelt!");
    await ben.submit("#lobby-chat-form");
    await anna.waitFor(`!document.querySelector('.dock-toggle[data-dock="right"] .dock-badge').hidden`, "Hinweis-Punkt");

    await anna.click('.dock-toggle[data-dock="right"]');
    assert.equal(await anna.eval(`return document.querySelector('.dock-toggle[data-dock="right"] .dock-badge').hidden;`), true, "Hinweis weg nach Ausklappen");
    await anna.click('.dock-toggle[data-dock="left"]');
    assert.equal(await anna.visible("#lobby-members-card"), true);

    // Globaler Chat: Hinweis an der eingeklappten Überschrift, Aufklappen per Klick
    await ben.fill("#global-chat-input", "Hallo alle");
    await ben.submit("#global-chat-form");
    await anna.waitFor(`!document.querySelector("#global-chat-card .dock-badge").hidden`, "Hinweis globaler Chat");
    await anna.click("#global-chat-card .section-toggle");
    assert.equal(await anna.visible("#global-chat-messages"), true, "globaler Chat ausgeklappt");
    assert.equal(await anna.eval(`return document.querySelector("#global-chat-card .dock-badge").hidden;`), true);
    await anna.click("#global-chat-card .section-toggle");
});
await test("Spielmodus mobil (420 px): Spiel zuerst, kein horizontales Scrollen", async () => {
    await ben.viewport(420, 900);
    await sleep(300);
    const game = await rectOf(ben, ".game-card");
    const header = await rectOf(ben, ".lobby-header");
    assert.ok(game.top < header.top, "Spiel über dem Lobby-Kopf");
    assert.equal(await ben.visible('.dock-toggle[data-dock="left"]'), false, "keine Dock-Schalter");
    const overflow = await ben.eval(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    await ben.screenshot("06-spielmodus-mobil.png");
    assert.ok(overflow <= 0, `horizontaler Überlauf: ${overflow}px`);
    await ben.viewport(1400, 1000);
});
await test("Würfeln und Auswertung bei beiden sichtbar", async () => {
    await anna.clickText(".rw-attacker .rw-buttons button", "3 Würfel");
    await ben.waitFor(`document.querySelectorAll(".rw-attacker .rw-die").length === 3`, "3 Angreifer-Würfel bei Ben");
    await anna.waitFor(`[...document.querySelectorAll(".rw-attacker .rw-buttons button")].every(b => b.disabled)`, "Angreifer gesperrt");
    await ben.clickText(".rw-defender .rw-buttons button", "2 Würfel");
    await anna.waitFor(`document.querySelectorAll(".rw-comparison").length === 2`, "Auswertung bei Anna");
    await ben.waitFor(`document.querySelector(".rw-summary")`, "Zusammenfassung bei Ben");
    assert.match(await anna.text(".rw-rolled-by"), /Anna/);
    await anna.screenshot("04-eroberungs-wuerfel.png");
});
await test("Reload mitten im Spiel stellt den Zustand wieder her", async () => {
    await ben.goto(APP);
    await ben.waitFor(`document.querySelectorAll(".rw-comparison").length === 2`, "Auswertung nach Reload", 6000);
    assert.equal(await ben.text("#lobby-name"), "Freitagsrunde");
    await ben.waitFor(`document.querySelectorAll("#lobby-chat-messages .chat-message").length > 0`, "Lobby-Chatverlauf");
});
await test("Host beendet Spiel → beide zurück in der Lobby-Ansicht", async () => {
    // confirm() würde den headless Browser blockieren → im Test automatisch bestätigen
    await anna.eval(`window.confirm = () => true;`);
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".rw")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".rw")`, "Spiel weg bei Anna");
    assert.equal(await anna.eval(`return document.querySelectorAll('link[href*="/games/"]').length;`), 0, "Spiel-CSS entfernt");
    assert.equal(await anna.visible("#host-game-controls"), true);
    assert.equal(await ben.text("#game-title"), "Kein Spiel ausgewählt");
    for (const page of [anna, ben]) {
        await page.waitFor(`!document.querySelector(".layout").classList.contains("game-mode")`, "Spielmodus beendet");
    }
    assert.equal(await anna.visible("#global-chat-messages"), true, "globaler Chat wieder sichtbar");
    assert.equal(await anna.visible('.dock-toggle[data-dock="left"]'), false, "Dock-Schalter ausgeblendet");
});

section("Revierkampf");

/** Klickt auf eine Stelle der Karte (Anteile 0–1 von Breite/Höhe). */
const clickMap = (page, fx, fy) => page.eval(`
    const canvas = document.querySelector(".rk-canvas");
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("click", { bubbles: true,
        clientX: r.left + r.width * ${fx}, clientY: r.top + r.height * ${fy} }));`);

/** Zahl der eigenen Felder aus der Statusleiste. */
const ownCells = page => page.eval(`
    const m = document.querySelector(".rk-stats")?.textContent.match(/(\\d+) Felder/);
    return m ? Number(m[1]) : -1;`);

await test("Host startet Revierkampf → Setup bei beiden", async () => {
    await startGame(anna, "revierkampf");
    await anna.waitFor(`document.querySelector('.rk[data-phase="setup"] .rk-start')`, "Setup mit Start-Button bei Anna");
    await ben.waitFor(`document.querySelector('.rk[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".rk-start") === null;`), true, "Ben hat keinen Start-Button");
    assert.equal(await anna.eval(`return document.querySelectorAll('link[href*="/games/revierkampf/style.css"]').length;`), 1);
});
await test("Bots einstellen und Runde starten", async () => {
    await anna.eval(`const s = document.querySelector(".rk-bots"); s.value = "2"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".rk-overlay").textContent.includes("Bots: 2")`, "Bens Anzeige: 2 Bots");
    await anna.click(".rk-start");
    await anna.waitFor(`document.querySelector('.rk[data-phase="spawn"]')`, "Startphase");
    await ben.waitFor(`document.querySelector(".rk-banner")?.textContent.includes("Startpunkt")`, "Hinweis bei Ben");
});
await test("Beide wählen per Klick einen Startpunkt", async () => {
    const spots = [[0.2, 0.3], [0.8, 0.7], [0.5, 0.5], [0.3, 0.8], [0.7, 0.2], [0.1, 0.6], [0.9, 0.4], [0.4, 0.15], [0.6, 0.85]];
    for (const [page, order] of [[anna, spots], [ben, [...spots].reverse()]]) {
        for (const [fx, fy] of order) {
            if (await page.eval(`return document.querySelector(".rk-banner").textContent.includes("gesetzt");`)) break;
            await clickMap(page, fx, fy);
            await sleep(250);
        }
        await page.waitFor(`document.querySelector(".rk-banner").textContent.includes("gesetzt")`, "Startpunkt gesetzt");
    }
});
await test("Runde startet nach dem Countdown, Karte und Rangliste sichtbar", async () => {
    await anna.waitFor(`document.querySelector('.rk[data-phase="running"]')`, "Runde läuft", 14000);
    assert.equal(await anna.eval(`return document.querySelectorAll(".rk-ranking li").length;`), 4, "2 Spieler + 2 Bots");
    assert.equal(await anna.visible(".rk-slider"), true, "Regler sichtbar");
    assert.ok(await ownCells(anna) > 0, "eigene Felder");
    const canvas = await rectOf(anna, ".rk-canvas");
    assert.ok(canvas.width > 700, `Karte nutzt die Breite (${canvas.width}px)`);

    // Handy-Ansicht: Karte passt in die Breite, kein horizontales Scrollen
    await ben.viewport(420, 900);
    await sleep(300);
    const overflow = await ben.eval(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    await ben.screenshot("08-revierkampf-mobil.png");
    await ben.viewport(1400, 1000);
    assert.ok(overflow <= 0, `horizontaler Überlauf: ${overflow}px`);
});
await test("Angriff per Klick vergrößert das eigene Revier", async () => {
    const before = await ownCells(anna);
    // Eigenes Feld anhand der Farbe auf dem Canvas finden (Anna = Spieler 0)
    const own = await anna.eval(`
        const canvas = document.querySelector(".rk-canvas");
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const cols = canvas.width / 8, rows = canvas.height / 8;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            const p = ((y * 8 + 1) * canvas.width + x * 8 + 1) * 4;
            if (data[p] === 219 && data[p + 1] === 24 && data[p + 2] === 71) return { x, y, cols, rows };
        }
        return null;`);
    assert.ok(own, "eigenes Revier auf der Karte gefunden");
    for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, -5]]) {
        await clickMap(anna, (own.x + dx + 0.5) / own.cols, (own.y + dy + 0.5) / own.rows);
    }
    await anna.waitFor(`(() => { const m = document.querySelector(".rk-stats").textContent.match(/(\\d+) Felder/);
        return m && Number(m[1]) > ${before} + 10; })()`, "Revier gewachsen", 5000);
    await anna.screenshot("07-revierkampf.png");
});
await test("Revierkampf im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".game-card") < 60, "Spielkarte dunkel");
    assert.equal(await ben.eval(`return document.querySelector(".rk-canvas").width > 0;`), true);
    await ben.screenshot("13-revierkampf-dark.png");
    await setTheme(ben, "light");
});
await test("Host beendet Revierkampf → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".rk")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".rk")`, "Spiel weg bei Anna");
    assert.equal(await anna.eval(`return document.querySelectorAll('link[href*="/games/"]').length;`), 0);
});

section("Schocken");

/** Anzahl verdeckter Würfel im Platz eines Spielers (aus Sicht der Seite). */
const hiddenDiceOf = (page, name) => page.eval(`
    const seat = [...document.querySelectorAll(".sk-seat")].find(s => s.querySelector(".sk-seat-name").textContent.startsWith(${JSON.stringify(name)}));
    return seat ? seat.querySelectorAll(".sk-die.sk-hidden").length : -1;`);
const enabled = (page, selector) => page.eval(`const b = document.querySelector(${JSON.stringify(selector)}); return !!b && !b.disabled;`);

await test("Host startet Schocken → Setup und Regel-Kurzfassung", async () => {
    await startGame(anna, "schocken");
    await anna.waitFor(`document.querySelector('.sk[data-phase="setup"] .sk-start')`, "Setup mit Start-Button bei Anna");
    await ben.waitFor(`document.querySelector('.sk[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".sk-start") === null;`), true, "Ben hat keinen Start-Button");
    assert.equal(await anna.visible(".sk-rules-table"), true, "Regeln unter dem Spielfeld sichtbar");
    const scroll = await anna.eval(`const b = document.querySelector(".sk-overlay-box"); return b.scrollHeight - b.clientHeight;`);
    assert.ok(scroll <= 1, `Setup-Dialog passt ohne Scrollen (Überhang ${scroll}px)`);
    await anna.screenshot("15-schocken-setup.png");
});
await test("Partie mit 1 Bot: Würfe bleiben für Mitspieler verdeckt, Auswertung erscheint", async () => {
    await anna.eval(`const s = document.querySelector(".sk-bots"); s.value = "1"; s.dispatchEvent(new Event("change"));`);
    await anna.eval(`const s = document.querySelector(".sk-mode"); s.value = "half"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".sk-overlay").textContent.includes("Bots: 1")`, "Bens Anzeige: 1 Bot");
    await anna.click(".sk-start");
    await anna.waitFor(`document.querySelector('.sk[data-phase="playing"]')`, "Partie läuft");
    assert.equal(await anna.eval(`return document.querySelectorAll(".sk-seat").length;`), 3);

    // Jeder Mensch würfelt: Becher bleibt zu (auch für ihn selbst). Der Erste deckt auf,
    // danach sehen beide seine Würfel; der andere beendet blind.
    let checkedHidden = false;
    let checkedLook = false;
    const end = Date.now() + 25000;
    while (Date.now() < end && !(await anna.visible(".sk-reveal-box"))) {
        for (const [page, other, name] of [[anna, ben, "Anna"], [ben, anna, "Ben"]]) {
            if (!(await enabled(page, ".sk-roll"))) continue;
            if (!checkedHidden) {
                // Laden: Hinweis, dass der eine Wurf schon um Deckel geht
                const hint = await page.text(".sk-panel-info");
                assert.ok(hint.includes("Laden") && hint.includes("Deckel"), `Laden-Hinweis: ${hint}`);
            }
            await page.click(".sk-roll");
            await page.waitFor(`document.querySelector(".sk-look")`, "Aufdecken-Button");
            assert.equal(await page.eval(`return document.querySelectorAll(".sk-panel-dice .sk-die.sk-hidden").length;`), 3,
                "eigene Würfel nach dem Wurf verdeckt");
            if (!checkedHidden) {
                // Die Sprung-/Dreh-Animation muss beim Werfer auch nach dem Neuaufbau
                // (Antwort auf den Klick) noch laufen.
                await sleep(250);
                const running = await page.eval(`return document.getAnimations()
                    .filter(a => a.animationName === "sk-tumble" && a.playState === "running"
                        && a.effect.target.closest(".sk-panel-dice")).length;`);
                assert.equal(running, 3, "3 laufende Würfel-Animationen im eigenen Becher");
            }
            await other.waitFor(`(() => { const seat = [...document.querySelectorAll(".sk-seat")].find(s => s.querySelector(".sk-seat-name").textContent.startsWith("${name}")); return seat && seat.querySelectorAll(".sk-die").length === 3; })()`, "Würfel im fremden Platz");
            assert.equal(await hiddenDiceOf(other, name), 3, "fremde Würfel sind verdeckt");
            checkedHidden = true;

            if (!checkedLook) {
                await page.click(".sk-look");
                await page.waitFor(`document.querySelectorAll(".sk-panel-dice .sk-die.sk-hidden").length === 0`, "eigene Würfel aufgedeckt");
                await other.waitFor(`(() => { const seat = [...document.querySelectorAll(".sk-seat")].find(s => s.querySelector(".sk-seat-name").textContent.startsWith("${name}")); return seat && seat.querySelectorAll(".sk-die.sk-hidden").length === 0; })()`, "Mitspieler sieht die aufgedeckten Würfel");
                checkedLook = true;
            }
            await page.waitFor(`!document.querySelector(".sk-finish")?.disabled`, "Beenden-Button aktiv");
            await page.click(".sk-finish");
        }
        await sleep(200);
    }
    assert.ok(checkedHidden && checkedLook, "Verdecken und Aufdecken geprüft");
    await anna.waitFor(`document.querySelector(".sk-reveal-box")`, "Auswertung", 3000);
    assert.equal(await anna.eval(`return document.querySelectorAll(".sk-reveal-list li").length;`), 3);
    assert.equal(await anna.eval(`return document.querySelectorAll(".sk-reveal-list .sk-die.sk-hidden").length;`), 0, "alles aufgedeckt");
    assert.match(await anna.text(".sk-reveal-box"), /Laden beendet – ab jetzt bis zu 3 Würfe/, "Hinweis nach dem Laden");
    await anna.screenshot("09-schocken.png");

    await ben.viewport(420, 900);
    await sleep(300);
    const overflow = await ben.eval(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    await ben.screenshot("10-schocken-mobil.png");
    await ben.viewport(1400, 1000);
    assert.ok(overflow <= 0, `horizontaler Überlauf: ${overflow}px`);

    // Dark-Mode: Auswertungs-Box und Regeln werden dunkel
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".sk-reveal-box") < 60, "Auswertung dunkel");
    assert.ok(await brightness(ben, ".sk-rules") < 60, "Regeln dunkel");
    await ben.screenshot("14-schocken-dark.png");
    await setTheme(ben, "light");
});
await test("Nächste Runde startet automatisch, nur Einsen lassen sich herauslegen", async () => {
    // "Weiter": Anna allein reicht nicht (2 Menschen → beide nötig), mit Ben geht es weiter
    await anna.waitFor(`document.querySelector(".sk-continue") && !document.querySelector(".sk-continue").disabled`, "Weiter-Button aktiv");
    await anna.click(".sk-continue");
    await ben.waitFor(`document.querySelector(".sk-continue")?.textContent.includes("1/2")`, "Ben sieht 1/2");
    await anna.waitFor(`document.querySelector(".sk-reveal-box")?.textContent.includes("Warte auf die anderen")`, "Anna wartet");
    assert.equal(await anna.visible(".sk-reveal-box"), true, "Auswertung bleibt nach einem Klick");
    await ben.waitFor(`!document.querySelector(".sk-continue").disabled`, "Bens Weiter-Button aktiv");
    await ben.click(".sk-continue");
    await anna.waitFor(`!document.querySelector(".sk-reveal-box") || document.querySelector(".sk-reveal").hidden`, "Auswertung weg", 3000);
    // Warten, bis ein Mensch am Zug ist (der Bot braucht ein paar Sekunden)
    let page = null;
    const end = Date.now() + 15000;
    while (!page && Date.now() < end) {
        if (await enabled(anna, ".sk-roll")) page = anna;
        else if (await enabled(ben, ".sk-roll")) page = ben;
        else await sleep(200);
    }
    assert.ok(page, "ein Mensch ist am Zug");
    // Würfeln und aufdecken, bis eine Eins dabei ist (oder keine Würfe mehr übrig sind)
    let heraus = false;
    for (let attempt = 0; attempt < 3 && !heraus; attempt++) {
        if (!(await enabled(page, ".sk-roll"))) break;
        await page.click(".sk-roll");
        await page.waitFor(`document.querySelector(".sk-look")`, "Becher zu");
        assert.equal(await page.eval(`return document.querySelectorAll(".sk-panel-dice .sk-clickable").length;`), 0,
            "verdeckt: nichts anklickbar");
        await page.click(".sk-look");
        await page.waitFor(`!document.querySelector(".sk-look")`, "aufgedeckt");
        const dice = await page.eval(`return [...document.querySelectorAll(".sk-panel-dice .sk-die")].map(d => ({
            label: d.getAttribute("aria-label"), clickable: d.classList.contains("sk-clickable"), aside: d.classList.contains("sk-aside") }));`);
        for (const die of dice) {
            if (die.clickable) assert.equal(die.label, "Würfel 1", "nur Einsen sind anklickbar");
        }
        const clickable = dice.filter(d => d.clickable).length;
        if (clickable > 0 && clickable < dice.filter(d => !d.aside).length) {
            await page.click(".sk-panel-dice .sk-die.sk-clickable");
            assert.equal(await page.eval(`return document.querySelectorAll(".sk-panel-dice .sk-selected").length;`), 1);
            await sleep(600); // Aufdeck-Animation abwarten
            await (page === anna ? ben : anna).screenshot("11-schocken-zug.png");
            await page.click(".sk-roll");
            await page.waitFor(`document.querySelectorAll(".sk-panel-dice .sk-aside").length >= 1`, "Eins herausgelegt");
            heraus = true;
        }
    }
    if (!heraus) await (page === anna ? ben : anna).screenshot("11-schocken-zug.png");
});
await test("Host beendet Schocken → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".sk")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".sk")`, "Spiel weg bei Anna");
});

section("Mäxchen");

await test("Host startet Mäxchen → Setup bei beiden", async () => {
    await startGame(anna, "maexchen");
    await anna.waitFor(`document.querySelector('.mx[data-phase="setup"] .mx-start')`, "Setup mit Start-Button bei Anna");
    await ben.waitFor(`document.querySelector('.mx[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".mx-start") === null;`), true, "Ben hat keinen Start-Button");
    await anna.eval(`const s = document.querySelector(".mx-bots"); s.value = "0"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".mx-overlay").textContent.includes("Bots: 0")`, "Bens Anzeige: 0 Bots");
    await anna.click(".mx-start");
    for (const page of [anna, ben]) await page.waitFor(`document.querySelector('.mx[data-phase="playing"]')`, "Partie läuft");
    assert.equal(await anna.eval(`return document.querySelectorAll(".mx-seat").length;`), 2);
});
await test("Würfeln: nur der Werfer sieht den Wurf, Anzweifeln deckt für beide auf", async () => {
    await anna.waitFor(`document.querySelector(".mx-roll") || document.querySelector(".mx-panel-info")?.textContent.includes("ist am Zug")`, "Zug verteilt");
    const annaFirst = await anna.eval(`return !!document.querySelector(".mx-roll");`);
    const [roller, other] = annaFirst ? [anna, ben] : [ben, anna];

    await roller.click(".mx-roll");
    await roller.waitFor(`document.querySelectorAll(".mx-panel-dice .mx-die").length === 2`, "eigene Würfel sichtbar");
    await roller.waitFor(`document.querySelector(".mx-cup.mx-shake")`, "Becher wackelt");
    await other.waitFor(`document.querySelector(".mx-seat-info")?.parentElement && [...document.querySelectorAll(".mx-seat-info")].some(e => e.textContent.includes("sagt an"))`, "Mitspieler sieht: sagt an");
    assert.equal(await other.eval(`return document.querySelectorAll(".mx-die").length;`), 0, "Mitspieler sieht keine Würfel");
    assert.ok(await roller.eval(`return document.querySelectorAll(".mx-value").length;`) === 21, "alle 21 Werte ansagbar");

    await roller.eval(`document.querySelectorAll(".mx-value")[13].click();`); // 65 ansagen
    await other.waitFor(`document.querySelector(".mx-doubt")`, "Entscheidung beim Mitspieler");
    assert.equal(await other.text(".mx-big"), "65");
    await other.screenshot("18-maexchen.png");
    await other.click(".mx-doubt");
    for (const page of [anna, ben]) {
        await page.waitFor(`document.querySelector(".mx-reveal-box .mx-die")`, "Aufdeckung mit Würfeln");
    }
    assert.ok(/Stimmt!|Gelogen!/.test(await anna.text(".mx-reveal-box h4")));
    assert.equal(await anna.eval(`return document.querySelectorAll(".mx-seat-loser").length;`), 1, "Verlierer markiert");
});
await test("Mäxchen im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".mx-panel") < 60, "Aktionsbereich dunkel");
    await ben.screenshot("19-maexchen-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Mäxchen → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".mx")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".mx")`, "Spiel weg bei Anna");
});

section("Lichtrenner");

/** Zeichnet in der Seite alle gesendeten Spielaktionen mit (window.__actions). */
const recordActions = page => page.eval(`
    window.__actions = [];
    if (!window.__fetchPatched) {
        window.__fetchPatched = true;
        const original = window.fetch;
        window.fetch = (url, options) => {
            if (String(url).includes("/api/game/action")) window.__actions.push(JSON.parse(options.body).action);
            return original(url, options);
        };
    }`);
const sentTurns = page => page.eval(`return window.__actions.filter(a => a.type === "turn").length;`);

await test("Host startet Lichtrenner → Countdown, dann läuft die Runde", async () => {
    await startGame(anna, "lichtrenner");
    await anna.waitFor(`document.querySelector('.lr[data-phase="setup"] .lr-start')`, "Setup mit Start-Button");
    await ben.waitFor(`document.querySelector('.lr[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".lr-start") === null;`), true, "Ben hat keinen Start-Button");
    await anna.eval(`const s = document.querySelector(".lr-bots"); s.value = "1"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".lr-overlay").textContent.includes("Bots: 1")`, "Bens Anzeige: 1 Bot");
    await recordActions(anna);
    await anna.click(".lr-start");
    for (const page of [anna, ben]) {
        await page.waitFor(`document.querySelector('.lr[data-phase="countdown"]') && !document.querySelector(".lr-countdown").hidden`, "Countdown sichtbar");
    }
    assert.equal(await anna.eval(`return document.querySelectorAll(".lr-scores li").length;`), 3, "2 Spieler + 1 Bot");
    await anna.waitFor(`document.querySelector('.lr[data-phase="running"]')`, "Runde läuft", 6000);
});
await test("Steuerung: Pfeiltasten und WASD lenken, Tippen im Chat nicht", async () => {
    const scrollBefore = await anna.eval(`return document.scrollingElement.scrollTop + (document.querySelector(".game-card")?.scrollTop ?? 0);`);
    await anna.eval(`document.activeElement?.blur();`);
    await anna.press("ArrowUp");
    await anna.press("ArrowLeft");
    await anna.waitFor(`window.__actions.filter(a => a.type === "turn").length >= 1`, "Pfeiltaste sendet turn");
    const afterArrows = await sentTurns(anna);
    await anna.press("s");
    await anna.press("d");
    await anna.waitFor(`window.__actions.filter(a => a.type === "turn").length > ${afterArrows}`, "WASD sendet turn");
    const scrollAfter = await anna.eval(`return document.scrollingElement.scrollTop + (document.querySelector(".game-card")?.scrollTop ?? 0);`);
    assert.equal(scrollAfter, scrollBefore, "Pfeiltasten scrollen die Seite nicht");

    const beforeChat = await sentTurns(anna);
    await anna.eval(`document.getElementById("lobby-chat-input").focus();`);
    for (const key of ["w", "a", "ArrowDown"]) await anna.press(key);
    await sleep(200);
    assert.equal(await sentTurns(anna), beforeChat, "keine Lenkbefehle aus dem Chatfeld");
    assert.equal(await anna.eval(`return document.getElementById("lobby-chat-input").value;`), "wa", "Buchstaben landen im Chat");
    await anna.eval(`const i = document.getElementById("lobby-chat-input"); i.value = ""; i.blur();`);
    await anna.screenshot("20-lichtrenner.png");
});
await test("Lichtrenner im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".lr-log") < 60, "Ereignisliste dunkel");
    await ben.screenshot("21-lichtrenner-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Lichtrenner → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".lr")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".lr")`, "Spiel weg bei Anna");
    assert.equal(await anna.eval(`return document.getElementById("awa-game-kit-controls") !== null;`), true, "Styles bleiben (einmalig)");
});

section("Bomben-Labyrinth");

const sentOfType = (page, type) => page.eval(`return window.__actions.filter(a => a.type === ${JSON.stringify(type)});`);

await test("Host startet Bomben-Labyrinth → Countdown, dann läuft die Runde", async () => {
    await startGame(anna, "bombenlabyrinth");
    await anna.waitFor(`document.querySelector('.bl[data-phase="setup"] .bl-start')`, "Setup mit Start-Button");
    await ben.waitFor(`document.querySelector('.bl[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".bl-start") === null;`), true, "Ben hat keinen Start-Button");
    await anna.eval(`const s = document.querySelector(".bl-bots"); s.value = "1"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".bl-overlay").textContent.includes("Bots: 1")`, "Bens Anzeige: 1 Bot");
    await recordActions(anna);
    await anna.click(".bl-start");
    for (const page of [anna, ben]) {
        await page.waitFor(`document.querySelector('.bl[data-phase="countdown"]') && !document.querySelector(".bl-countdown").hidden`, "Countdown sichtbar");
    }
    assert.equal(await anna.eval(`return document.querySelectorAll(".bl-scores li").length;`), 3, "2 Spieler + 1 Bot");
    await anna.waitFor(`document.querySelector('.bl[data-phase="running"]')`, "Runde läuft", 6000);
    assert.match(await anna.text(".bl-stats"), /💣 1 +🔥 2 +👟 1/, "Power-up-Stand");
});
await test("Steuerung: Taste halten läuft, Loslassen stoppt, Leertaste legt Bombe", async () => {
    await anna.eval(`document.activeElement?.blur();`);
    await anna.keyDown("ArrowRight");
    await anna.waitFor(`window.__actions.some(a => a.type === "move" && a.dir === "right")`, "move right gesendet");
    await sleep(150);
    await anna.keyDown("ArrowDown");
    await anna.waitFor(`window.__actions.some(a => a.type === "move" && a.dir === "down")`, "zweite Taste übernimmt");
    await anna.keyUp("ArrowDown");
    await anna.waitFor(`window.__actions.filter(a => a.type === "move").at(-1).dir === "right"`, "zurück zur noch gehaltenen Taste");
    await anna.keyUp("ArrowRight");
    await anna.waitFor(`window.__actions.filter(a => a.type === "move").at(-1).dir === null`, "Loslassen → Stillstand");
    const moves = (await sentOfType(anna, "move")).length;
    await anna.press("ArrowLeft");
    await anna.waitFor(`window.__actions.filter(a => a.type === "move").length === ${moves + 2}`, "Antippen = Halten + Loslassen");

    await anna.press(" ");
    await anna.waitFor(`window.__actions.some(a => a.type === "bomb")`, "Leertaste legt Bombe");

    const before = (await sentOfType(anna, "move")).length + (await sentOfType(anna, "bomb")).length;
    await anna.eval(`document.getElementById("lobby-chat-input").focus();`);
    for (const key of ["w", "a", " "]) await anna.press(key);
    await sleep(200);
    assert.equal((await sentOfType(anna, "move")).length + (await sentOfType(anna, "bomb")).length, before, "keine Steuerbefehle aus dem Chatfeld");
    assert.equal(await anna.eval(`return document.getElementById("lobby-chat-input").value;`), "wa ", "Zeichen landen im Chat");
    await anna.eval(`const i = document.getElementById("lobby-chat-input"); i.value = ""; i.blur();`);
    await anna.screenshot("22-bombenlabyrinth.png");
});
await test("Bomben-Labyrinth im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".bl-log") < 60, "Ereignisliste dunkel");
    await ben.screenshot("23-bombenlabyrinth-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Bomben-Labyrinth → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".bl")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".bl")`, "Spiel weg bei Anna");
});

section("Artillerie-Duell");

await test("Host startet Artillerie-Duell → beide in der Zielphase", async () => {
    await startGame(anna, "artillerie");
    await anna.waitFor(`document.querySelector('.ad[data-phase="setup"] .ad-start')`, "Setup mit Start-Button");
    await ben.waitFor(`document.querySelector('.ad[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".ad-start") === null;`), true, "Ben hat keinen Start-Button");
    await anna.eval(`const s = document.querySelector(".ad-bots"); s.value = "1"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".ad-overlay").textContent.includes("Bots: 1 (mittel)")`, "Bens Anzeige: 1 Bot, mittel");
    assert.equal(await anna.eval(`return document.querySelectorAll(".ad-bot-level option").length;`), 3, "drei Bot-Stärken");
    await anna.eval(`const s = document.querySelector(".ad-bot-level"); s.value = "leicht"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".ad-overlay").textContent.includes("Bots: 1 (leicht)")`, "Bens Anzeige: leicht");
    await recordActions(anna);
    await anna.click(".ad-start");
    for (const page of [anna, ben]) {
        await page.waitFor(`document.querySelector('.ad[data-phase="aiming"]') && !document.querySelector(".ad-panel").hidden`, "Zielphase mit Bedienleiste");
    }
    assert.equal(await anna.eval(`return document.querySelectorAll(".ad-scores li").length;`), 3, "2 Spieler + 1 Bot");
    assert.equal(await anna.eval(`return document.querySelectorAll(".ad-weapon").length;`), 3, "drei Waffen");
});
await test("Zielen per Taste halten, Kraft mit E, Feuer frei mit Leertaste → Salve fliegt", async () => {
    await anna.eval(`document.activeElement?.blur();`);
    const before = Number(await anna.eval(`return document.querySelector(".ad-angle").value;`));
    await anna.keyDown("ArrowUp");
    await sleep(400);
    await anna.keyUp("ArrowUp");
    const after = Number(await anna.eval(`return document.querySelector(".ad-angle").value;`));
    assert.ok(after > before + 2, `Winkel gestiegen: ${before} → ${after}`);
    await anna.waitFor(`window.__actions.some(a => a.type === "aim" && a.angle === ${after})`, "aim gesendet");
    const power = Number(await anna.eval(`return document.querySelector(".ad-power").value;`));
    await anna.keyDown("e");
    await anna.keyUp("e");
    await anna.waitFor(`Number(document.querySelector(".ad-power").value) === ${power + 1}`, "Kraft +1");
    // Regler ohne Innenabstand: bei 100 sitzt der Knopf am rechten Rand der Schiene
    const range = await anna.eval(`
        const input = document.querySelector(".ad-power");
        const style = getComputedStyle(input);
        return { padding: style.paddingLeft + " " + style.paddingRight, border: style.borderLeftWidth };`);
    assert.deepEqual(range, { padding: "0px 0px", border: "0px" }, "Schieberegler ohne Innenabstand und Rahmen");
    await anna.click('.ad-weapon[data-weapon="splitter"]');
    await anna.waitFor(`document.querySelector('.ad-weapon[data-weapon="splitter"]').getAttribute("aria-pressed") === "true"`, "Splitter gewählt");
    await anna.screenshot("24-artillerie.png");

    await anna.press(" ");
    await anna.waitFor(`window.__actions.some(a => a.type === "ready" && a.weapon === "splitter" && a.angle === ${after})`, "ready mit Zielwerten");
    await anna.waitFor(`document.querySelector(".ad-fire").classList.contains("is-ready")`, "Anna bereit");
    await ben.click(".ad-fire");
    for (const page of [anna, ben]) await page.waitFor(`document.querySelector('.ad[data-phase="flight"]')`, "Salve fliegt", 8000);
    await sleep(1200);
    await ben.screenshot("25-artillerie-salve.png");
    await anna.waitFor(`["aiming", "roundOver"].includes(document.querySelector(".ad").dataset.phase)`, "nächste Salve", 25000);
});
await test("Artillerie-Duell im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".ad-log") < 60, "Ereignisliste dunkel");
    await ben.screenshot("26-artillerie-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Artillerie-Duell → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".ad")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".ad")`, "Spiel weg bei Anna");
});

section("Feierabend-Fäuste");

await test("Figurenwahl: jede Figur nur einmal, Host stellt ein und startet", async () => {
    await startGame(anna, "feierabend-faeuste");
    await anna.waitFor(`document.querySelector('.ff[data-phase="setup"] .ff-start')`, "Setup mit Start-Button");
    await ben.waitFor(`document.querySelector('.ff[data-phase="setup"]')`, "Setup bei Ben");
    assert.equal(await anna.eval(`return document.querySelectorAll(".ff-figure").length;`), 4, "vier Figuren");
    await anna.click('.ff-figure[data-figure="hausmeister"]');
    await ben.waitFor(`document.querySelector('.ff-figure[data-figure="hausmeister"]').disabled`, "bei Ben vergeben");
    await ben.click('.ff-figure[data-figure="kurierin"]');
    await anna.waitFor(`document.querySelector('.ff-figure[data-figure="kurierin"]').textContent.includes("Ben")`, "Anna sieht Bens Wahl");
    assert.equal(await ben.eval(`return document.querySelector(".ff-start") === null;`), true, "Ben hat keinen Start-Button");
    await anna.eval(`const s = document.querySelector(".ff-allies"); s.value = "1"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".ff-overlay").textContent.includes("Bot-Kollegen: 1")`, "Bens Anzeige: 1 Bot-Kollege");
    await anna.screenshot("27-feierabend-faeuste-wahl.png");
    await recordActions(anna);
    await anna.click(".ff-start");
    for (const page of [anna, ben]) await page.waitFor(`document.querySelector('.ff[data-phase="playing"]') && document.querySelector(".ff-overlay").hidden`, "Spiel läuft");
});
await test("Steuerung: Laufen per Taste halten, Schlag, Sprung und Spezial", async () => {
    await anna.eval(`document.activeElement?.blur();`);
    await anna.keyDown("ArrowRight");
    await anna.keyDown("ArrowDown");
    await anna.waitFor(`window.__actions.some(a => a.type === "move" && a.dx === 1 && a.dz === 1)`, "schräg laufen");
    await sleep(300);
    await anna.keyUp("ArrowDown");
    await anna.waitFor(`window.__actions.filter(a => a.type === "move").at(-1).dz === 0`, "nur noch rechts");
    await anna.keyUp("ArrowRight");
    await anna.waitFor(`(a => a.dx === 0 && a.dz === 0)(window.__actions.filter(a => a.type === "move").at(-1))`, "stehen bleiben");
    for (const key of [" ", "j", "k", "l"]) await anna.press(key);
    await anna.waitFor(`["attack", "jump", "special"].every(t => window.__actions.some(a => a.type === t))
        && window.__actions.filter(a => a.type === "attack").length >= 2`, "Schlag (Leertaste und J), Sprung, Spezial");
    await sleep(600);
    await anna.screenshot("28-feierabend-faeuste.png");
});
await test("Feierabend-Fäuste im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".ff-log") < 60, "Ereignisliste dunkel");
    await ben.screenshot("29-feierabend-faeuste-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Feierabend-Fäuste → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".ff")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".ff")`, "Spiel weg bei Anna");
});

section("Turmwacht");

/** Klickt Felder der Karte nacheinander an, bis das Bau-Menü erscheint; liefert das Feld. */
const selectFreeCell = page => page.eval(`
    const canvas = document.querySelector(".tw-canvas");
    const rect = canvas.getBoundingClientRect();
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 16; x++) {
            canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + (x + 0.5) * rect.width / 16, clientY: rect.top + (y + 0.5) * rect.height / 10 }));
            if (document.querySelector(".tw-build-btn")) return { x, y };
        }
    }
    return null;`);
const myGold = page => page.eval(`return parseInt(document.querySelector(".tw-member.is-me .tw-gold").textContent, 10);`);

await test("Setup: Host würfelt die Karte neu, stellt ein und startet", async () => {
    await startGame(anna, "turmwacht");
    await anna.waitFor(`document.querySelector('.tw[data-phase="setup"] .tw-start')`, "Setup mit Start-Button");
    await ben.waitFor(`document.querySelector('.tw[data-phase="setup"] .tw-panel')`, "Setup bei Ben");
    assert.equal(await ben.eval(`return document.querySelector(".tw-start") === null;`), true, "Ben hat keinen Start-Button");
    const before = await ben.eval(`return document.querySelector(".tw-canvas").toDataURL();`);
    await anna.click(".tw-new-map");
    await ben.waitFor(`document.querySelector(".tw-canvas").toDataURL() !== ${JSON.stringify(before)}`, "neue Karte bei Ben");
    await anna.eval(`const s = document.querySelector(".tw-waves"); s.value = "10"; s.dispatchEvent(new Event("change"));`);
    await ben.waitFor(`document.querySelector(".tw-panel").textContent.includes("10 Wellen")`, "Ben sieht 10 Wellen");
    await anna.screenshot("30-turmwacht-setup.png");
    await recordActions(anna);
    await anna.click(".tw-start");
    for (const page of [anna, ben]) await page.waitFor(`document.querySelector('.tw[data-phase="build"]') && document.querySelector(".tw-overlay").hidden`, "Bauphase");
    assert.equal(await myGold(anna), 125, "Startgold geteilt");
});
await test("Bauen, Upgraden und Schenken", async () => {
    const cell = await selectFreeCell(anna);
    assert.ok(cell, "freies Feld gefunden");
    assert.equal(await anna.eval(`return document.querySelectorAll(".tw-build-btn").length;`), 5, "fünf Turmtypen");
    await anna.click('.tw-build-btn[data-tower="pfeil"]');
    await anna.waitFor(`document.querySelector(".tw-upgrade")`, "Turm-Infos nach dem Bau");
    assert.equal(await myGold(anna), 75);
    await anna.click(".tw-upgrade");
    await anna.waitFor(`document.querySelector(".tw-panel h4")?.textContent.includes("Stufe 2")`, "Stufe 2");
    assert.equal(await myGold(anna), 45);
    await ben.waitFor(`document.querySelector(".tw-member.is-me .tw-gold")`, "Kasse bei Ben");
    await anna.click(".tw-gift");
    await ben.waitFor(`parseInt(document.querySelector(".tw-member.is-me .tw-gold").textContent, 10) === 150`, "Ben bekommt 25 Gold");
    await anna.waitFor(`document.querySelector(".tw-log").textContent.includes("schenkt")`, "Geschenk im Log");
    assert.deepEqual(await anna.eval(`return window.__actions.map(a => a.type);`), ["start", "build", "upgrade", "gift"]);
    await anna.screenshot("31-turmwacht-bauen.png");
});
await test("Alle bereit → Welle startet", async () => {
    await anna.click(".tw-ready");
    await ben.waitFor(`document.querySelector(".tw-ready").textContent.includes("1/2")`, "Ben sieht 1/2 bereit");
    await ben.click(".tw-ready");
    for (const page of [anna, ben]) await page.waitFor(`document.querySelector('.tw[data-phase="wave"]')`, "Welle läuft");
    await sleep(1500);
    await anna.screenshot("32-turmwacht-welle.png");
});
await test("Turmwacht im Dark-Mode", async () => {
    await setTheme(ben, "dark");
    await sleep(300);
    assert.ok(await brightness(ben, ".tw-panel") < 60, "Auswahl-Leiste dunkel");
    await ben.screenshot("33-turmwacht-dunkel.png");
    await setTheme(ben, "light");
});
await test("Host beendet Turmwacht → zurück in der Lobby", async () => {
    await anna.click("#end-game-button");
    await ben.waitFor(`!document.querySelector(".tw")`, "Spiel weg bei Ben");
    await anna.waitFor(`!document.querySelector(".tw")`, "Spiel weg bei Anna");
});

section("Host-Wechsel und private Lobbys");

await test("Host verlässt Lobby → Ben wird Host", async () => {
    await anna.click("#leave-lobby-button");
    await anna.waitFor(`!document.getElementById("view-overview").hidden`, "Anna in Übersicht");
    await ben.waitFor(`!document.getElementById("host-game-controls").hidden`, "Ben hat Host-Steuerung");
    assert.match(await ben.text("#member-list"), /👑 Ben/);
});
await test("Private Lobby per Einladungslink", async () => {
    await ben.click("#leave-lobby-button");
    await ben.waitFor(`!document.getElementById("view-overview").hidden`, "Ben in Übersicht");
    await ben.fill("#create-lobby-name", "Geheim");
    await ben.eval(`document.getElementById("create-lobby-visibility").value = "private";`);
    await ben.submit("#create-lobby-form");
    await ben.waitFor(`!document.getElementById("view-lobby").hidden`, "Ben in privater Lobby");

    // Über localhost geöffnet → Link muss die LAN-Adresse enthalten (sofern vorhanden)
    const link = await ben.eval(`return document.getElementById("invite-link").value;`);
    assert.match(link, /\/\?join=[A-Z0-9]{6}$/);
    const lanUrls = (await (await fetch(APP + "/api/info")).json()).lanUrls;
    if (lanUrls.length > 0) assert.ok(link.startsWith(lanUrls[0]), "LAN-Adresse statt localhost: " + link);

    await sleep(200);
    assert.equal(await anna.eval(`return document.querySelectorAll("#lobby-list .lobby-item").length;`), 0, "nicht in der Liste");

    // Gleiche Origin wie Annas Sitzung verwenden (localStorage ist pro Adresse getrennt)
    await anna.goto(`${APP}/${link.split("/").pop()}`);
    await anna.waitFor(`!document.getElementById("view-lobby").hidden`, "Anna per Link beigetreten", 6000);
    assert.equal(await anna.text("#lobby-name"), "Geheim");
    assert.equal(await anna.eval(`return location.search;`), "", "URL aufgeräumt");
});
await test("Beitritt per Code-Feld (kleingeschrieben)", async () => {
    const code = await ben.text("#lobby-code");
    await anna.click("#leave-lobby-button");
    await anna.waitFor(`!document.getElementById("view-overview").hidden`, "Übersicht");
    await anna.fill("#join-code-input", code.toLowerCase());
    assert.equal(await anna.eval(`return document.getElementById("join-code-input").value;`), code);
    await anna.submit("#join-code-form");
    await anna.waitFor(`!document.getElementById("view-lobby").hidden`, "per Code beigetreten");
});

section("Darstellung und Abmeldung");

await test("Mobile Ansicht (420 px) ohne horizontales Scrollen", async () => {
    await ben.viewport(420, 900);
    await sleep(300);
    const overflow = await ben.eval(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    await ben.screenshot("05-mobil.png");
    assert.ok(overflow <= 0, `horizontaler Überlauf: ${overflow}px`);
    await ben.viewport(1400, 1000);
});
await test("Abmelden → Login-Ansicht, Ben sieht 1 Online", async () => {
    await anna.click("#logout-button");
    await anna.waitFor(`!document.getElementById("view-login").hidden`, "Login");
    await ben.waitFor(`document.getElementById("online-count").textContent === "1"`, "1 online");
});
await test("Keine JavaScript-Fehler in der Konsole", async () => {
    assert.equal(consoleProblems.length, 0, "\n       " + consoleProblems.join("\n       "));
});

// ---------------------------------------------------------------------------
cdp.close();
browser.kill();
server.stop();
await sleep(500);
fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

console.log(`\nScreenshots: ${OUTPUT_DIR}`);
process.exit(summary());
