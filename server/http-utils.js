"use strict";

/**
 * Hilfsfunktionen rund um HTTP:
 *  - HttpError:   Fehler, der direkt als HTTP-Antwort an den Client geht
 *  - readJsonBody: liest und prüft den JSON-Body eines Requests
 *  - sendJson / sendError / sendText: einheitliche Antworten
 *  - serveStatic: sichere Auslieferung statischer Dateien
 */

const fs = require("fs");
const path = require("path");

/**
 * Fehler mit HTTP-Statuscode. Wird er in einem API-Handler geworfen,
 * erhält der Client genau diesen Status und diese Meldung.
 */
class HttpError extends Error {
    /**
     * @param {number} status   HTTP-Statuscode (z. B. 400, 403, 404)
     * @param {string} message  Für Menschen lesbare Meldung (wird im Client angezeigt)
     * @param {string} [code]   Optionaler maschinenlesbarer Code, z. B. "PASSWORD_REQUIRED"
     */
    constructor(status, message, code) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.code = code;
    }
}

/** Content-Types für die ausgelieferten Dateiendungen. */
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg"
};

/**
 * Liest den Body eines Requests und parst ihn als JSON-Objekt.
 * Ein leerer Body ergibt ein leeres Objekt.
 *
 * @param {import("http").IncomingMessage} req
 * @param {number} maxBytes  Obergrenze, um Speicher-Missbrauch zu verhindern
 * @returns {Promise<object>}
 */
function readJsonBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;

        req.on("data", chunk => {
            if (tooLarge) return; // Rest des Bodys ignorieren
            size += chunk.length;
            if (size > maxBytes) {
                tooLarge = true;
                reject(new HttpError(413, "Die Anfrage ist zu groß."));
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => {
            if (tooLarge) return;

            const text = Buffer.concat(chunks).toString("utf8").trim();
            if (text === "") {
                resolve({});
                return;
            }

            try {
                const data = JSON.parse(text);
                if (data === null || typeof data !== "object" || Array.isArray(data)) {
                    throw new Error("Kein JSON-Objekt");
                }
                resolve(data);
            } catch {
                reject(new HttpError(400, "Ungültiges JSON."));
            }
        });

        req.on("error", reject);
    });
}

/** Sendet ein Objekt als JSON-Antwort. */
function sendJson(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
}

/** Sendet eine Fehlerantwort im einheitlichen Format { ok: false, error, code }. */
function sendError(res, status, message, code) {
    sendJson(res, status, { ok: false, error: message, code });
}

/** Sendet eine einfache Textantwort (für statische Dateien / 404). */
function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
}

/**
 * Liefert eine Datei aus `rootDir` aus.
 *
 * Sicherheit: Der aufgelöste Pfad muss innerhalb von `rootDir` liegen.
 * Versuche wie "/../server.js" oder "/%2e%2e/server.js" führen zu 404.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {string} rootDir  Verzeichnis, aus dem ausgeliefert werden darf
 * @param {string} urlPath  Pfad aus der URL (ohne Query-String), z. B. "/css/style.css"
 */
async function serveStatic(req, res, rootDir, urlPath) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Methode nicht erlaubt");
        return;
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(urlPath);
    } catch {
        sendText(res, 400, "Ungültige URL");
        return;
    }
    if (decodedPath.includes("\0")) {
        sendText(res, 400, "Ungültige URL");
        return;
    }

    const root = path.resolve(rootDir);
    const filePath = path.join(root, decodedPath);

    // Path-Traversal-Schutz: Datei muss unterhalb von root liegen.
    if (!filePath.startsWith(root + path.sep)) {
        sendText(res, 404, "Nicht gefunden");
        return;
    }

    let stats;
    try {
        stats = await fs.promises.stat(filePath);
    } catch {
        sendText(res, 404, "Nicht gefunden");
        return;
    }
    if (!stats.isFile()) {
        sendText(res, 404, "Nicht gefunden");
        return;
    }

    res.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": stats.size,
        "Cache-Control": "no-cache" // Browser fragt nach, ob es eine neue Version gibt
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
}

module.exports = {
    HttpError,
    readJsonBody,
    sendJson,
    sendError,
    sendText,
    serveStatic
};
