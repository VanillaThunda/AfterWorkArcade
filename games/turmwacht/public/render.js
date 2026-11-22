/**
 * Turmwacht – Zeichnen auf dem Canvas (Karte, Türme, Gegner, Effekte).
 * Das Spielfeld behält in beiden Designs seine eigenen Farben.
 * Koordinaten: Felder (x, y); CELL Pixel pro Feld.
 */

export const CELL = 48;

const GRASS = ["#7fbf5a", "#79b854"];
const PATH = "#d8c08a";
const PATH_EDGE = "#b89f68";

/** Karte: Wiese, Pfad, Deko, Ein- und Ausgang. */
export function drawMap(g, map) {
    for (let y = 0; y < map.rows; y++) {
        for (let x = 0; x < map.cols; x++) {
            g.fillStyle = GRASS[(x + y) % 2];
            g.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
    }
    // Pfad als durchgehendes Band
    g.lineCap = "round";
    g.lineJoin = "round";
    const line = (width, color) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        map.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * CELL, y * CELL) : g.lineTo(x * CELL, y * CELL)));
        g.stroke();
    };
    line(CELL * 0.92, PATH_EDGE);
    line(CELL * 0.78, PATH);

    for (let y = 0; y < map.rows; y++) {
        for (let x = 0; x < map.cols; x++) {
            const c = map.grid[y * map.cols + x];
            if (c === "r") drawRock(g, (x + 0.5) * CELL, (y + 0.5) * CELL, x * 7 + y);
            if (c === "t") drawTree(g, (x + 0.5) * CELL, (y + 0.5) * CELL);
        }
    }
    const [ex, ey] = map.points[map.points.length - 1];
    drawGate(g, (ex - 1.0) * CELL, ey * CELL);
    const [sx, sy] = map.points[0];
    g.fillStyle = "rgba(120, 30, 30, 0.75)";
    g.beginPath();
    g.moveTo((sx + 0.6) * CELL - 6, sy * CELL - 12);
    g.lineTo((sx + 0.6) * CELL + 12, sy * CELL);
    g.lineTo((sx + 0.6) * CELL - 6, sy * CELL + 12);
    g.closePath();
    g.fill();
}

function drawRock(g, cx, cy, seed) {
    g.fillStyle = "#8d8d8d";
    g.beginPath();
    g.ellipse(cx, cy + 4, CELL * 0.34, CELL * 0.26, (seed % 3) * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#a9a9a9";
    g.beginPath();
    g.ellipse(cx - 4, cy, CELL * 0.2, CELL * 0.14, 0, 0, Math.PI * 2);
    g.fill();
}

function drawTree(g, cx, cy) {
    g.fillStyle = "#6d4c2f";
    g.fillRect(cx - 3, cy + 4, 6, 14);
    g.fillStyle = "#2e7d32";
    g.beginPath();
    g.arc(cx, cy - 2, CELL * 0.32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#43a047";
    g.beginPath();
    g.arc(cx - 5, cy - 7, CELL * 0.16, 0, Math.PI * 2);
    g.fill();
}

function drawGate(g, cx, cy) {
    g.fillStyle = "#6b5b4b";
    g.fillRect(cx - 14, cy - 22, 28, 44);
    g.fillStyle = "#3e3329";
    g.beginPath();
    g.moveTo(cx - 8, cy + 22);
    g.lineTo(cx - 8, cy - 4);
    g.arc(cx, cy - 4, 8, Math.PI, 0);
    g.lineTo(cx + 8, cy + 22);
    g.fill();
    g.fillStyle = "#6b5b4b";
    for (let i = 0; i < 3; i++) g.fillRect(cx - 14 + i * 11, cy - 28, 6, 7);
}

/** Turm auf Feld (x, y). ownerColor = Rand in Besitzerfarbe. */
export function drawTower(g, tower, ownerColor, catalogTower, aimAt) {
    const cx = (tower.x + 0.5) * CELL;
    const cy = (tower.y + 0.5) * CELL;
    const s = CELL * 0.4;
    g.fillStyle = "#e9e2d0";
    g.strokeStyle = ownerColor ?? "#777";
    g.lineWidth = 4;
    roundRect(g, cx - s, cy - s, s * 2, s * 2, 7);
    g.fill();
    g.stroke();
    const color = catalogTower.color;
    g.fillStyle = color;
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 1.5;
    const r = CELL * 0.24;
    switch (tower.type) {
        case "pfeil":
            g.beginPath();
            g.moveTo(cx, cy - r - 2);
            g.lineTo(cx + r, cy + r - 2);
            g.lineTo(cx - r, cy + r - 2);
            g.closePath();
            g.fill();
            g.stroke();
            break;
        case "kanone": {
            const angle = aimAt ? Math.atan2(aimAt.y * CELL - cy, aimAt.x * CELL - cx) : -Math.PI / 2;
            g.save();
            g.translate(cx, cy);
            g.rotate(angle);
            g.fillStyle = "#37474f";
            g.fillRect(0, -4, r + 8, 8);
            g.restore();
            g.fillStyle = color;
            g.beginPath();
            g.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            break;
        }
        case "frost":
            g.beginPath();
            g.moveTo(cx, cy - r - 3);
            g.lineTo(cx + r, cy);
            g.lineTo(cx, cy + r + 3);
            g.lineTo(cx - r, cy);
            g.closePath();
            g.fill();
            g.stroke();
            g.strokeStyle = "#fff";
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(cx - r * 0.5, cy);
            g.lineTo(cx + r * 0.5, cy);
            g.moveTo(cx, cy - r * 0.5);
            g.lineTo(cx, cy + r * 0.5);
            g.stroke();
            break;
        case "blitz":
            g.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = -Math.PI / 2 + (i * Math.PI) / 3;
                const px = cx + Math.cos(a) * r;
                const py = cy + Math.sin(a) * r;
                if (i === 0) g.moveTo(px, py);
                else g.lineTo(px, py);
            }
            g.closePath();
            g.fill();
            g.stroke();
            g.fillStyle = "#ffeb3b";
            g.beginPath();
            g.moveTo(cx + 2, cy - r * 0.75);
            g.lineTo(cx - 5, cy + 1);
            g.lineTo(cx, cy + 1);
            g.lineTo(cx - 2, cy + r * 0.75);
            g.lineTo(cx + 5, cy - 1);
            g.lineTo(cx, cy - 1);
            g.closePath();
            g.fill();
            break;
        case "fernrohr":
            g.beginPath();
            g.arc(cx, cy, r, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.strokeStyle = "#fff";
            g.lineWidth = 2;
            g.beginPath();
            g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
            g.moveTo(cx - r, cy);
            g.lineTo(cx + r, cy);
            g.moveTo(cx, cy - r);
            g.lineTo(cx, cy + r);
            g.stroke();
            break;
        default:
            break;
    }
    // Stufe als Punkte
    for (let i = 0; i < tower.level; i++) {
        g.fillStyle = "#ffd23f";
        g.strokeStyle = "#5d4200";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx - 10.5 + i * 7, cy + s - 5, 2.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }
}

/** Gegner an Bildschirmposition (px, py). */
export function drawEnemy(g, enemy, px, py, def, now) {
    const r = def.size * CELL;
    const bob = Math.sin(now / 120 + px * 0.05) * 1.5;
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.beginPath();
    g.ellipse(px, py + r * 0.8, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    g.fill();
    const y = py + bob;
    g.fillStyle = def.color;
    g.strokeStyle = enemy.slowT > 0 ? "#81d4fa" : "rgba(0,0,0,0.45)";
    g.lineWidth = enemy.slowT > 0 ? 3 : 1.5;
    g.beginPath();
    switch (enemy.type) {
        case "flitzer":
            g.moveTo(px + r * 1.1, y);
            g.lineTo(px - r * 0.8, y - r * 0.9);
            g.lineTo(px - r * 0.8, y + r * 0.9);
            g.closePath();
            break;
        case "panzer":
            roundRect(g, px - r, y - r, r * 2, r * 2, 4);
            break;
        default:
            g.arc(px, y, r, 0, Math.PI * 2);
    }
    g.fill();
    g.stroke();
    if (enemy.type === "koloss") {
        g.strokeStyle = "#ffd23f";
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(px, y, r * 0.65, 0, Math.PI * 2);
        g.stroke();
    }
    if (enemy.type === "panzer") {
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(px - r * 0.6, y - r * 0.15, r * 1.2, r * 0.3);
    }
    // Augen
    if (enemy.type !== "schwarm") {
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(px + r * 0.3, y - r * 0.2, Math.max(1.8, r * 0.18), 0, Math.PI * 2);
        g.fill();
    }
    if (enemy.hp < enemy.maxHp) {
        const w = Math.max(16, r * 2.2);
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(px - w / 2, y - r - 8, w, 4);
        const share = Math.max(0, enemy.hp / enemy.maxHp);
        g.fillStyle = share > 0.5 ? "#66bb6a" : share > 0.25 ? "#ffb300" : "#e53935";
        g.fillRect(px - w / 2, y - r - 8, w * share, 4);
    }
}

/** Effekte; age in Ticks (0 … fxTicks). */
export function drawFx(g, effect, age, fxTicks) {
    const fade = Math.max(0, 1 - age / fxTicks);
    const P = v => v * CELL;
    g.save();
    g.globalAlpha = fade;
    switch (effect.k) {
        case "arrow":
            g.strokeStyle = "#5d4037";
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(P(effect.from.x), P(effect.from.y));
            g.lineTo(P(effect.to.x), P(effect.to.y));
            g.stroke();
            break;
        case "boom":
            g.fillStyle = "rgba(255, 152, 0, 0.55)";
            g.beginPath();
            g.arc(P(effect.to.x), P(effect.to.y), P(effect.r) * (0.6 + 0.4 * (age / fxTicks)), 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = "#37474f";
            g.lineWidth = 1.5;
            g.setLineDash([3, 4]);
            g.beginPath();
            g.moveTo(P(effect.from.x), P(effect.from.y));
            g.lineTo(P(effect.to.x), P(effect.to.y));
            g.stroke();
            break;
        case "frost":
            g.strokeStyle = "rgba(129, 212, 250, 0.9)";
            g.lineWidth = 3;
            g.beginPath();
            g.arc(P(effect.from.x), P(effect.from.y), P(effect.r) * (0.4 + 0.6 * (age / fxTicks)), 0, Math.PI * 2);
            g.stroke();
            break;
        case "zap":
            g.strokeStyle = "#e1bee7";
            g.lineWidth = 3;
            g.shadowColor = "#ab47bc";
            g.shadowBlur = 8;
            g.beginPath();
            g.moveTo(P(effect.from.x), P(effect.from.y));
            for (const pt of effect.pts) g.lineTo(P(pt.x) + (Math.random() - 0.5) * 6, P(pt.y) + (Math.random() - 0.5) * 6);
            g.stroke();
            break;
        case "snipe":
            g.strokeStyle = "#ff6d00";
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(P(effect.from.x), P(effect.from.y));
            g.lineTo(P(effect.to.x), P(effect.to.y));
            g.stroke();
            break;
        case "die":
            g.fillStyle = "#ffd23f";
            g.strokeStyle = "rgba(0,0,0,0.6)";
            g.lineWidth = 3;
            g.font = "bold 13px Arial, sans-serif";
            g.textAlign = "center";
            g.strokeText(`+${effect.gold}`, P(effect.x), P(effect.y) - 8 - age * 5);
            g.fillText(`+${effect.gold}`, P(effect.x), P(effect.y) - 8 - age * 5);
            break;
        case "leak":
            g.fillStyle = "rgba(229, 57, 53, 0.5)";
            g.beginPath();
            g.arc(P(effect.x) - 20, P(effect.y), 26, 0, Math.PI * 2);
            g.fill();
            break;
        default:
            break;
    }
    g.restore();
}

/** Reichweiten-Kreis (Auswahl / Bau-Vorschau). */
export function drawRange(g, x, y, range, color = "rgba(255,255,255,0.9)") {
    g.save();
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.arc((x + 0.5) * CELL, (y + 0.5) * CELL, range * CELL, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
}

/** Rahmen um das gewählte Feld. */
export function drawSelection(g, x, y, ok) {
    g.save();
    g.strokeStyle = ok ? "#fff" : "#e53935";
    g.lineWidth = 3;
    g.strokeRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
    g.restore();
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
