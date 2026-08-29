const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const publicDir = path.join(__dirname, "public");
const clients = new Set();

function rollDice(count) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

function sendState(state) {
    const message = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) {
        if (!client.destroyed) client.write(message);
    }
}

const server = http.createServer((req, res) => {
    if (req.url === "/events" && req.method === "GET") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive"
        });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
    }

    if (req.url === "/roll" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);

        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const side = data.side;
                const count = Number(data.count);

                if (!["attacker", "defender"].includes(side) ||
                    ![1, 2, 3].includes(count)) {
                    res.writeHead(400);
                    res.end("Invalid request");
                    return;
                }

                const dice = rollDice(count);
                sendState({ side, dice, timestamp: Date.now() });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            } catch {
                res.writeHead(400);
                res.end("Invalid JSON");
            }
        });
        return;
    }

    let file = req.url === "/" ? "/index.html" : req.url;
    file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
    const filePath = path.join(publicDir, file);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8"
        };

        res.writeHead(200, {
            "Content-Type": types[path.extname(filePath)] || "application/octet-stream"
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Risiko-Würfel läuft auf http://localhost:${PORT}`);
});
