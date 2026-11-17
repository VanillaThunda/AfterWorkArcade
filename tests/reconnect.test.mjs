/**
 * Reconnect-Test: prüft die Grace-Period bei Verbindungsabbrüchen.
 *
 *  - Kurzer Abbruch (z. B. Reload) → User bleibt angemeldet und in der Lobby.
 *  - Langer Abbruch → User wird automatisch abgemeldet, verlässt die Lobby,
 *    ein anderes Mitglied wird Host und der Name ist wieder frei.
 *
 * Die Grace-Period wird für den Test per Umgebungsvariable auf 2 s verkürzt.
 *
 * Start:  npm run test:reconnect   bzw.  node tests/reconnect.test.mjs
 */

import assert from "node:assert/strict";
import { startServer, createTestRunner, apiCall, openEventStream, sleep } from "./helpers.mjs";

const GRACE_MS = 2000;

const server = await startServer(3457, { HOST: "127.0.0.1", RECONNECT_GRACE_MS: String(GRACE_MS) });
const call = (method, urlPath, body, token) => apiCall(server.baseUrl, method, urlPath, body, token);
const { test, section, summary } = createTestRunner();

section("Grace-Period");

const anna = (await call("POST", "/api/login", { name: "Anna" })).data;
const ben = (await call("POST", "/api/login", { name: "Ben" })).data;
let streamAnna = openEventStream(server.baseUrl, anna.token);
const streamBen = openEventStream(server.baseUrl, ben.token);
await sleep(200);

const lobby = (await call("POST", "/api/lobby/create", { name: "X", visibility: "public" }, anna.token)).data;
await call("POST", "/api/lobby/join", { lobbyId: lobby.lobbyId }, ben.token);

await test("Kurzer Abbruch: bleibt angemeldet und in der Lobby", async () => {
    streamAnna.close();
    await sleep(GRACE_MS / 2);
    streamAnna = openEventStream(server.baseUrl, anna.token);
    await streamAnna.waitFor(e => e.type === "lobby" && e.data?.id === lobby.lobbyId, "wieder in Lobby");
    await sleep(GRACE_MS); // ursprünglicher Timer wäre jetzt abgelaufen
    assert.equal((await call("GET", "/api/me", undefined, anna.token)).status, 200);
});

await test("Langer Abbruch: automatisch abgemeldet, Ben wird Host", async () => {
    const newHost = streamBen.next(e => e.type === "lobby" && e.data?.hostId === ben.user.id, "Ben ist Host", GRACE_MS + 2000);
    streamAnna.close();
    await newHost;
    assert.equal((await call("GET", "/api/me", undefined, anna.token)).status, 401);
});

await test("Name ist danach wieder frei", async () => {
    assert.equal((await call("POST", "/api/login", { name: "Anna" })).status, 200);
});

await test("Login ohne Event-Stream verfällt ebenfalls", async () => {
    const ghost = (await call("POST", "/api/login", { name: "Geist" })).data;
    await sleep(GRACE_MS + 500);
    assert.equal((await call("GET", "/api/me", undefined, ghost.token)).status, 401);
});

streamBen.close();
server.stop();
process.exit(summary());
