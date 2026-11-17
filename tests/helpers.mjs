/**
 * Gemeinsame Hilfsfunktionen für die Tests.
 *
 *  - startServer:      startet den Server als eigenen Prozess auf einem Test-Port
 *  - createTestRunner: minimaler Test-Runner mit "ok"/"FAIL"-Ausgabe
 *  - apiCall:          HTTP-Anfrage an die API
 *  - openEventStream:  liest den SSE-Stream eines Users mit
 *
 * Die Tests nutzen nur Bordmittel von Node.js (fetch, node:assert) –
 * es müssen keine npm-Pakete installiert werden.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Projektordner (_stable), unabhängig davon, von wo aus der Test gestartet wird. */
export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Startet den Server auf dem angegebenen Port.
 * @param {number} port
 * @param {Record<string, string>} [extraEnv]  zusätzliche Umgebungsvariablen
 * @returns {Promise<{baseUrl: string, stop: () => void, getLog: () => string}>}
 */
export async function startServer(port, extraEnv = {}) {
    const child = spawn(process.execPath, ["server.js"], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PORT: String(port), ...extraEnv }
    });

    let log = "";
    child.stdout.on("data", chunk => { log += chunk; });
    child.stderr.on("data", chunk => { log += chunk; });

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server startet nicht:\n" + log)), 10000);
        child.stdout.on("data", () => {
            if (log.includes("läuft auf Port")) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.on("exit", code => reject(new Error(`Server beendet (Code ${code}):\n${log}`)));
    });

    return {
        // 127.0.0.1 statt "localhost": Unter Windows wird "localhost" zuerst
        // per IPv6 (::1) versucht, was Verbindungen unnötig verzögert.
        baseUrl: `http://127.0.0.1:${port}`,
        stop: () => child.kill(),
        getLog: () => log
    };
}

/** Minimaler Test-Runner. */
export function createTestRunner() {
    let passed = 0;
    const failures = [];

    return {
        /** Führt einen Testfall aus und gibt das Ergebnis aus. */
        async test(name, fn) {
            try {
                await fn();
                passed++;
                console.log("  ok   " + name);
            } catch (err) {
                failures.push(name);
                console.log("  FAIL " + name + "\n       " + err.message);
            }
        },

        section(title) {
            console.log("\n" + title);
        },

        /** Gibt die Zusammenfassung aus und liefert den Exit-Code (0 = alles ok). */
        summary() {
            console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
            return failures.length === 0 ? 0 : 1;
        }
    };
}

/**
 * Schickt eine Anfrage an die API.
 * @returns {Promise<{status: number, data: any, headers: Headers}>}
 */
export async function apiCall(baseUrl, method, path, body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }
    return { status: response.status, data, headers: response.headers };
}

/**
 * Öffnet den SSE-Stream eines Users und sammelt alle Events.
 *
 *  - waitFor(pred): wartet auf ein Event (auch auf bereits empfangene)
 *  - next(pred):    wartet auf ein Event, das NACH dem Aufruf eintrifft
 */
export function openEventStream(baseUrl, token) {
    const events = [];
    const waiters = [];
    const controller = new AbortController();

    function notify(event) {
        for (const waiter of [...waiters]) {
            if (waiter.predicate(event)) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(event);
            }
        }
    }

    (async () => {
        try {
            const response = await fetch(`${baseUrl}/events?token=${token}`, { signal: controller.signal });
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // SSE-Nachrichten sind durch eine Leerzeile getrennt.
                let separator;
                while ((separator = buffer.indexOf("\n\n")) !== -1) {
                    const block = buffer.slice(0, separator);
                    buffer = buffer.slice(separator + 2);

                    let type = "message";
                    let data = "";
                    for (const line of block.split("\n")) {
                        if (line.startsWith("event: ")) type = line.slice(7);
                        else if (line.startsWith("data: ")) data += line.slice(6);
                    }
                    if (!data) continue; // Kommentare wie ": ping" ignorieren

                    const event = { type, data: JSON.parse(data) };
                    events.push(event);
                    notify(event);
                }
            }
        } catch {
            // Abbruch durch close()
        }
    })();

    function wait(predicate, label, timeout) {
        return new Promise((resolve, reject) => {
            const waiter = { predicate, resolve };
            waiters.push(waiter);
            setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) {
                    waiters.splice(index, 1);
                    reject(new Error(`Timeout: ${label}`));
                }
            }, timeout);
        });
    }

    return {
        events,
        close: () => controller.abort(),
        waitFor(predicate, label = "Event", timeout = 2000) {
            const found = events.find(predicate);
            return found ? Promise.resolve(found) : wait(predicate, label, timeout);
        },
        next(predicate, label = "Event", timeout = 2000) {
            return wait(predicate, label, timeout);
        }
    };
}
