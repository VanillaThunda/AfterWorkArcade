/**
 * Feierabend-Fäuste – Zeichnen auf dem Canvas (Kulissen, Figuren, Effekte, HUD).
 *
 * Alles wird aus einfachen Formen gezeichnet (eigene Figuren und Kulissen, keine
 * Grafikdateien). Welt → Bildschirm: x relativ zur Kamera, die Bodenfläche liegt
 * im unteren Bilddrittel (z = Tiefe, h = Höhe über dem Boden).
 */

export const SCALE = 2;                 // Canvas-Pixel pro Welteinheit
export const VIEW_H = 270;              // Höhe des Ausschnitts (Welteinheiten)
export const FLOOR_TOP = 150;           // Bildschirm-y (Einheiten) der hinteren Bodenkante

const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524"];
const TAU = Math.PI * 2;

/** Aussehen der Figuren (Spieler und Gegner). */
const LOOKS = {
    kurierin: { coat: "#e4572e", pants: "#2d3142", skin: SKIN[0], hair: "#6b3e26", hat: "cap", extra: "backpack", size: 1 },
    lagerist: { coat: "#2e86de", pants: "#1b3a5c", skin: SKIN[1], hair: "#3b2a1a", hat: "beanie", extra: null, size: 1 },
    hausmeister: { coat: "#27ae60", pants: "#4a3b2a", skin: SKIN[2], hair: null, hat: null, extra: "moustache", size: 1.12, width: 1.25 },
    monteurin: { coat: "#c9a227", pants: "#34495e", skin: SKIN[0], hair: "#c0392b", hat: "helmet", extra: "wrench", size: 1 },
    schlaeger: { coat: "#7d5ba6", pants: "#2c2c34", skin: SKIN[1], hair: null, hat: "hood", extra: null, size: 1 },
    werfer: { coat: "#b5651d", pants: "#3d3d3d", skin: SKIN[3], hair: "#111", hat: "cap", extra: "bottle", size: 0.95 },
    brocken: { coat: "#5d6d7e", pants: "#2c3e50", skin: SKIN[2], hair: null, hat: null, extra: "vest", size: 1.25, width: 1.45 },
    boss: { coat: "#8e1b1b", pants: "#1c1c1c", skin: SKIN[0], hair: "#555", hat: null, extra: "tie", size: 1.45, width: 1.35 }
};

/** Kulissen je Abschnitt: Himmel, Wand/Hintergrund, Boden. */
const SCENES = {
    hinterhof: { sky: ["#ff9a5a", "#7b4fa0"], far: "#4b3a63", wall: "#9b4a3c", wallLine: "#7a3328", floor: "#55575e", floorLine: "#6a6c73", window: "#ffd27a" },
    lagerhalle: { sky: ["#3a3f4b", "#1f232b"], far: "#2c313b", wall: "#6c7580", wallLine: "#57606a", floor: "#8a8f96", floorLine: "#9aa0a7", window: "#cfe3ff" },
    dach: { sky: ["#ff7e5f", "#2b1d4e"], far: "#1d1636", wall: "#3d3550", wallLine: "#2c2640", floor: "#4a4452", floorLine: "#5a5462", window: "#ffe08a" },
    chefetage: { sky: ["#141a2e", "#30264f"], far: "#0e1222", wall: "#5b4636", wallLine: "#4a3828", floor: "#7d2f2f", floorLine: "#913a3a", window: "#9fd0ff" }
};

// ===========================================================================
// Hilfen
// ===========================================================================

/** Fester Pseudo-Zufall für Kulissen (gleiches Bild bei jedem Neuzeichnen). */
function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function screenY(z, h = 0) {
    return (FLOOR_TOP + z - h) * SCALE;
}

function line(g, x1, y1, x2, y2, width, color) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
}

// ===========================================================================
// Kulissen
// ===========================================================================

export function drawBackground(g, sceneId, camX, width, height) {
    const scene = SCENES[sceneId] ?? SCENES.hinterhof;
    const sky = g.createLinearGradient(0, 0, 0, FLOOR_TOP * SCALE);
    sky.addColorStop(0, scene.sky[1]);
    sky.addColorStop(1, scene.sky[0]);
    g.fillStyle = sky;
    g.fillRect(0, 0, width, FLOOR_TOP * SCALE);

    // Ferne Silhouette (langsame Parallaxe)
    const farShift = camX * 0.2;
    g.fillStyle = scene.far;
    for (let i = Math.floor(farShift / 60) - 1; i < Math.floor(farShift / 60) + 10; i++) {
        const x = (i * 60 - farShift) * SCALE;
        const h = 40 + hash(i) * 60;
        g.fillRect(x, (FLOOR_TOP - 20 - h) * SCALE, 52 * SCALE, (h + 20) * SCALE);
        g.fillStyle = scene.window;
        for (let w = 0; w < 6; w++) {
            if (hash(i * 7 + w) > 0.55) g.fillRect(x + (8 + (w % 3) * 14) * SCALE, (FLOOR_TOP - h + 10 + Math.floor(w / 3) * 16) * SCALE, 6 * SCALE, 8 * SCALE);
        }
        g.fillStyle = scene.far;
    }

    // Mittlere Ebene: je Abschnitt eigene Kulisse (Parallaxe 0.6)
    const midShift = camX * 0.6;
    if (sceneId === "hinterhof") drawBackyard(g, scene, midShift);
    else if (sceneId === "lagerhalle") drawWarehouse(g, scene, midShift);
    else if (sceneId === "dach") drawRoof(g, scene, midShift);
    else drawOffice(g, scene, midShift);

    // Boden mit Tiefenlinien
    const floorTop = FLOOR_TOP * SCALE;
    g.fillStyle = scene.floor;
    g.fillRect(0, floorTop, width, height - floorTop);
    g.strokeStyle = scene.floorLine;
    g.lineWidth = 2;
    for (let i = Math.floor(camX / 40) - 2; i < Math.floor(camX / 40) + 16; i++) {
        const x = (i * 40 - camX) * SCALE;
        g.beginPath();
        g.moveTo(x, floorTop);
        g.lineTo(x - 30 * SCALE, height);
        g.stroke();
    }
    for (const z of [30, 70]) line(g, 0, screenY(z), width, screenY(z), 1, scene.floorLine);
    g.fillStyle = "rgba(0, 0, 0, 0.25)";
    g.fillRect(0, floorTop, width, 4 * SCALE);
}

function drawBackyard(g, scene, shift) {
    const top = 50 * SCALE;
    g.fillStyle = scene.wall;
    g.fillRect(0, top, 960, (FLOOR_TOP * SCALE) - top);
    g.strokeStyle = scene.wallLine;
    g.lineWidth = 2;
    for (let row = 0; row < 13; row++) {
        const y = top + row * 8 * SCALE;
        line(g, 0, y, 960, y, 2, scene.wallLine);
        for (let i = -1; i < 26; i++) {
            const x = ((i * 20 + (row % 2) * 10) - (shift % 20)) * SCALE;
            line(g, x, y, x, y + 8 * SCALE, 2, scene.wallLine);
        }
    }
    for (let i = Math.floor(shift / 120) - 1; i < Math.floor(shift / 120) + 6; i++) {
        const x = (i * 120 - shift + 30) * SCALE;
        g.fillStyle = "#3b2f2f";
        g.fillRect(x, 68 * SCALE, 40 * SCALE, 34 * SCALE);
        g.fillStyle = hash(i + 3) > 0.4 ? scene.window : "#5b6b7b";
        g.fillRect(x + 3 * SCALE, 71 * SCALE, 34 * SCALE, 28 * SCALE);
        line(g, x + 20 * SCALE, 71 * SCALE, x + 20 * SCALE, 99 * SCALE, 3, "#3b2f2f");
        // Mülltonne
        const bx = x + 70 * SCALE;
        g.fillStyle = "#2f5d50";
        g.fillRect(bx, 122 * SCALE, 24 * SCALE, 28 * SCALE);
        g.fillStyle = "#24493f";
        g.fillRect(bx - 2 * SCALE, 118 * SCALE, 28 * SCALE, 5 * SCALE);
    }
    // Zaun vorne an der Wand
    g.fillStyle = "#6d4c35";
    for (let i = Math.floor(shift / 12) - 1; i < Math.floor(shift / 12) + 42; i++) {
        g.fillRect((i * 12 - shift) * SCALE, 128 * SCALE, 9 * SCALE, 22 * SCALE);
    }
}

function drawWarehouse(g, scene, shift) {
    g.fillStyle = scene.wall;
    g.fillRect(0, 20 * SCALE, 960, (FLOOR_TOP - 20) * SCALE);
    // Dachträger
    for (let i = Math.floor(shift / 80) - 1; i < Math.floor(shift / 80) + 8; i++) {
        const x = (i * 80 - shift) * SCALE;
        line(g, x, 20 * SCALE, x + 40 * SCALE, 45 * SCALE, 4, scene.wallLine);
        line(g, x + 40 * SCALE, 45 * SCALE, x + 80 * SCALE, 20 * SCALE, 4, scene.wallLine);
        g.fillStyle = "rgba(255, 240, 200, 0.5)";
        g.beginPath();
        g.arc(x + 40 * SCALE, 48 * SCALE, 5 * SCALE, 0, TAU);
        g.fill();
    }
    // Regale mit Kisten
    for (let i = Math.floor(shift / 140) - 1; i < Math.floor(shift / 140) + 6; i++) {
        const x = (i * 140 - shift) * SCALE;
        g.fillStyle = "#2c4f7c";
        for (const y of [70, 100, 130]) g.fillRect(x, y * SCALE, 110 * SCALE, 4 * SCALE);
        g.fillRect(x, 66 * SCALE, 4 * SCALE, 84 * SCALE);
        g.fillRect(x + 106 * SCALE, 66 * SCALE, 4 * SCALE, 84 * SCALE);
        for (let b = 0; b < 9; b++) {
            if (hash(i * 13 + b) < 0.3) continue;
            const shelf = [70, 100, 130][b % 3];
            g.fillStyle = hash(i + b) > 0.5 ? "#c8995a" : "#a87a44";
            g.fillRect(x + (8 + Math.floor(b / 3) * 32) * SCALE, (shelf - 20) * SCALE, 26 * SCALE, 20 * SCALE);
        }
    }
}

function drawRoof(g, scene, shift) {
    // Brüstung und Aufbauten
    for (let i = Math.floor(shift / 110) - 1; i < Math.floor(shift / 110) + 7; i++) {
        const x = (i * 110 - shift) * SCALE;
        if (hash(i) > 0.5) {
            g.fillStyle = "#6b5b73";
            g.fillRect(x + 20 * SCALE, 70 * SCALE, 18 * SCALE, 60 * SCALE);   // Schornstein
            g.fillStyle = "#4c4054";
            g.fillRect(x + 17 * SCALE, 66 * SCALE, 24 * SCALE, 6 * SCALE);
        } else {
            line(g, x + 40 * SCALE, 40 * SCALE, x + 40 * SCALE, 128 * SCALE, 3, "#2a2238"); // Antenne
            line(g, x + 28 * SCALE, 55 * SCALE, x + 52 * SCALE, 55 * SCALE, 3, "#2a2238");
            line(g, x + 32 * SCALE, 68 * SCALE, x + 48 * SCALE, 68 * SCALE, 3, "#2a2238");
        }
        g.fillStyle = "#58506a";
        g.fillRect(x + 60 * SCALE, 112 * SCALE, 40 * SCALE, 24 * SCALE);           // Lüftungskasten
        g.fillStyle = "#3e3750";
        for (let s = 0; s < 4; s++) g.fillRect(x + (64 + s * 9) * SCALE, 116 * SCALE, 5 * SCALE, 16 * SCALE);
    }
    g.fillStyle = scene.wall;
    g.fillRect(0, 134 * SCALE, 960, 16 * SCALE);
    g.fillStyle = scene.wallLine;
    g.fillRect(0, 134 * SCALE, 960, 3 * SCALE);
}

function drawOffice(g, scene, shift) {
    g.fillStyle = scene.wall;
    g.fillRect(0, 30 * SCALE, 960, (FLOOR_TOP - 30) * SCALE);
    // Große Fenster mit Nachtstadt
    for (let i = 0; i < 4; i++) {
        const x = (20 + i * 118 - shift * 0.2) * SCALE;
        g.fillStyle = "#0b1020";
        g.fillRect(x, 45 * SCALE, 96 * SCALE, 70 * SCALE);
        g.fillStyle = scene.window;
        for (let w = 0; w < 14; w++) {
            if (hash(i * 31 + w) > 0.5) g.fillRect(x + (6 + (w % 7) * 13) * SCALE, (85 + Math.floor(w / 7) * 12) * SCALE, 5 * SCALE, 6 * SCALE);
        }
        g.strokeStyle = "#3a2a1f";
        g.lineWidth = 3 * SCALE;
        g.strokeRect(x, 45 * SCALE, 96 * SCALE, 70 * SCALE);
    }
    // Wanduhr und Schreibtisch
    g.fillStyle = "#f5f0e6";
    g.beginPath();
    g.arc(240 * SCALE, 30 * SCALE + 6 * SCALE, 10 * SCALE, 0, TAU);
    g.fill();
    line(g, 240 * SCALE, 36 * SCALE, 240 * SCALE, 30 * SCALE, 2, "#222");
    line(g, 240 * SCALE, 36 * SCALE, 245 * SCALE, 38 * SCALE, 2, "#222");
    g.fillStyle = "#4a3021";
    g.fillRect(360 * SCALE, 126 * SCALE, 90 * SCALE, 8 * SCALE);
    g.fillRect(366 * SCALE, 134 * SCALE, 6 * SCALE, 16 * SCALE);
    g.fillRect(438 * SCALE, 134 * SCALE, 6 * SCALE, 16 * SCALE);
}

// ===========================================================================
// Figuren
// ===========================================================================

/**
 * Pose aus Animation und Zeit: Winkel (Bogenmaß, 0 = nach unten, positiv = nach vorn)
 * für Arme/Beine, Neigung des Oberkörpers, liegend ja/nein.
 */
function poseFor(actor, t) {
    const anim = actor.anim;
    const p = { armF: 0.2, armB: -0.2, elbowF: 0.4, elbowB: 0.4, legF: 0.1, legB: -0.1, knee: 0.1, lean: 0, lying: 0, crouch: 0 };
    if (anim === "walk") {
        const s = Math.sin(t * 0.55);
        Object.assign(p, { legF: s * 0.55, legB: -s * 0.55, armF: -s * 0.45, armB: s * 0.45, knee: Math.abs(s) * 0.4 });
    } else if (anim === "idle") {
        p.crouch = Math.sin(t * 0.15) * 0.8;
    } else if (anim.startsWith("punch")) {
        const extend = t >= 1 && t <= 5;
        if (anim === "punch2") Object.assign(p, { armB: extend ? 1.6 : 0.6, elbowB: extend ? 0 : 1.2, armF: -0.3, lean: 0.12 });
        else if (anim === "punch3") Object.assign(p, { armF: extend ? 2.4 : 0.6, elbowF: extend ? 0.2 : 1.4, armB: extend ? 2.2 : 0.4, lean: extend ? 0.2 : -0.1, legF: 0.5, legB: -0.4 });
        else Object.assign(p, { armF: extend ? 1.6 : 0.6, elbowF: extend ? 0 : 1.2, lean: 0.1 });
    } else if (anim === "jump") {
        Object.assign(p, { legF: 0.9, legB: 0.4, knee: 1.4, armF: 2.4, armB: 2.0 });
    } else if (anim === "jumpkick") {
        Object.assign(p, { legF: 1.5, knee: 0, legB: -0.3, armF: -0.6, armB: 0.8, lean: -0.25 });
    } else if (anim === "special") {
        const spin = Math.sin(t * 1.6);
        Object.assign(p, { armF: 1.6, armB: -1.6 + spin * 0.4, elbowF: 0, elbowB: 0, lean: spin * 0.2, legF: 0.5, legB: -0.5 });
    } else if (anim === "hurt") {
        Object.assign(p, { lean: -0.35, armF: -0.5, armB: -0.8 });
    } else if (anim === "down" || anim === "ko" || anim === "dying") {
        p.lying = 1;
    } else if (anim === "getup") {
        p.lying = Math.max(0, 1 - t / 8);
        p.crouch = 6;
    } else if (anim === "punch" || anim === "throw" || anim === "charge" || anim === "stomp") {
        // Gegner-Angriffe: erst ausholen (Arm zurück), dann zuschlagen
        const attackT = actor.attack?.t ?? t;
        const windup = attackT < (anim === "stomp" ? 20 : anim === "charge" ? 16 : 9);
        if (anim === "stomp") Object.assign(p, windup ? { armF: 2.3, armB: 2.5, elbowF: -0.7, elbowB: -0.5, crouch: -4 } : { armF: 0.4, armB: 0.4, crouch: 8, legF: 0.6, legB: -0.6 });
        else if (anim === "charge") Object.assign(p, windup ? { lean: -0.1, crouch: 4, armF: -0.4 } : { lean: 0.5, armF: 1.2, armB: 1.0, legF: Math.sin(t) * 0.7, legB: -Math.sin(t) * 0.7 });
        else Object.assign(p, windup ? { armF: -0.9, elbowF: 1.6, lean: -0.15 } : { armF: 1.6, elbowF: 0, lean: 0.15 });
    }
    return p;
}

/**
 * Eine Figur zeichnen. (sx, sy) = Bildschirmposition der Füße.
 * @param {object} options  { look, facing, flash, alpha, label, labelColor, telegraph }
 */
export function drawFighter(g, actor, sx, sy, t, { look, facing, flash = false, alpha = 1, label = null, labelColor = "#fff" }) {
    const size = (look.size ?? 1) * SCALE;
    const widthScale = look.width ?? 1;
    const pose = poseFor(actor, t);
    g.save();
    g.globalAlpha = alpha;
    g.translate(sx, sy);

    // Schatten
    g.fillStyle = "rgba(0, 0, 0, 0.28)";
    g.beginPath();
    g.ellipse(0, (actor.h ?? 0) * SCALE, 13 * size * widthScale, 4 * size, 0, 0, TAU);
    g.fill();

    if (pose.lying > 0) g.rotate(-facing * pose.lying * Math.PI / 2 * 0.95);
    g.scale(facing, 1);
    const crouch = pose.crouch * size * 0.3;
    const legLen = 10 * size;
    const hipY = -legLen * 2 + crouch;
    const shoulderY = hipY - 17 * size;
    const limb = 4.6 * size * widthScale;
    const skin = flash ? "#ffffff" : look.skin;
    const coat = flash ? "#ffffff" : look.coat;

    const leg = (angle, knee, color) => {
        const kx = Math.sin(angle) * legLen;
        const ky = hipY + Math.cos(angle) * legLen;
        const fx = kx + Math.sin(angle - knee) * legLen;
        const fy = ky + Math.cos(angle - knee) * legLen;
        line(g, 0, hipY, kx, ky, limb * 1.1, color);
        line(g, kx, ky, fx, fy, limb, color);
        line(g, fx, fy, fx + 3.5 * size, fy, limb * 0.9, "#1a1a1a");
    };
    const arm = (angle, elbow, color, front) => {
        const len = 8.5 * size;
        const ex = Math.sin(angle) * len;
        const ey = shoulderY + 1 + Math.cos(angle) * len;
        const hx = ex + Math.sin(angle + elbow) * len;
        const hy = ey + Math.cos(angle + elbow) * len;
        line(g, 0, shoulderY + 1, ex, ey, limb, color);
        line(g, ex, ey, hx, hy, limb * 0.9, color);
        g.fillStyle = skin;
        g.beginPath();
        g.arc(hx, hy, limb * 0.6, 0, TAU);
        g.fill();
        if (front && look.extra === "wrench") {
            line(g, hx, hy, hx + Math.sin(angle + elbow) * 16 * size, hy + Math.cos(angle + elbow) * 16 * size, 3 * size, "#7f8c8d");
        }
        if (front && look.extra === "bottle") {
            g.fillStyle = "#3d8b5a";
            g.fillRect(hx - 2 * size, hy - 6 * size, 4 * size, 8 * size);
        }
    };

    g.lineCap = "round";
    // Hinteres Bein/Arm etwas dunkler
    leg(pose.legB, pose.knee, shade(look.pants, -25));
    arm(pose.armB, pose.elbowB, shade(coat, -30), false);
    leg(pose.legF, pose.knee * 0.6, look.pants);

    // Oberkörper
    g.save();
    g.rotate(pose.lean);
    if (look.extra === "backpack") {
        g.fillStyle = "#3b3b3b";
        g.fillRect(-12 * size, shoulderY + 1, 7 * size, 14 * size);
    }
    g.fillStyle = coat;
    roundRect(g, -7 * size * widthScale, shoulderY - 1, 14 * size * widthScale, hipY - shoulderY + 3 * size, 4 * size);
    g.fill();
    if (look.extra === "vest") {
        g.fillStyle = flash ? "#fff" : "#f39c12";
        g.fillRect(-7 * size * widthScale, shoulderY + 5 * size, 14 * size * widthScale, 3 * size);
    }
    if (look.extra === "tie") {
        g.fillStyle = "#f1f1f1";
        g.fillRect(-2.5 * size, shoulderY, 5 * size, 6 * size);
        g.fillStyle = "#d4ac0d";
        g.beginPath();
        g.moveTo(0, shoulderY + 1);
        g.lineTo(2 * size, shoulderY + 10 * size);
        g.lineTo(0, shoulderY + 13 * size);
        g.lineTo(-2 * size, shoulderY + 10 * size);
        g.fill();
    }
    // Kopf
    const headY = shoulderY - 7 * size;
    g.fillStyle = skin;
    g.beginPath();
    g.arc(1 * size, headY, 6.2 * size, 0, TAU);
    g.fill();
    g.fillStyle = "#1a1a1a";
    g.beginPath();
    g.arc(4 * size, headY - 1 * size, 1.1 * size, 0, TAU);
    g.fill();
    drawHeadwear(g, look, size, headY, flash);
    g.restore();

    arm(pose.armF, pose.elbowF, coat, true);
    g.restore();

    if (label) {
        g.font = `bold ${7 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.lineWidth = 3 * SCALE;
        g.strokeStyle = "rgba(0, 0, 0, 0.7)";
        const ly = sy + (hipY - 24 * (look.size ?? 1) * SCALE) - (actor.h ?? 0) * 0;
        g.strokeText(label, sx, ly);
        g.fillStyle = labelColor;
        g.fillText(label, sx, ly);
    }
}

function drawHeadwear(g, look, size, headY, flash) {
    const dark = flash ? "#fff" : null;
    if (look.hat === "cap") {
        g.fillStyle = dark ?? shade(look.coat, -40);
        g.beginPath();
        g.arc(1 * size, headY - 1 * size, 6.4 * size, Math.PI, TAU);
        g.fill();
        g.fillRect(1 * size, headY - 2 * size, 9 * size, 2.2 * size);
    } else if (look.hat === "beanie") {
        g.fillStyle = dark ?? "#c0392b";
        g.beginPath();
        g.arc(1 * size, headY - 1 * size, 6.6 * size, Math.PI, TAU);
        g.fill();
        g.fillRect(-5.6 * size, headY - 2 * size, 13.2 * size, 2.5 * size);
    } else if (look.hat === "helmet") {
        g.fillStyle = dark ?? "#f1c40f";
        g.beginPath();
        g.arc(1 * size, headY - 1.5 * size, 7 * size, Math.PI, TAU);
        g.fill();
        g.fillRect(-7 * size, headY - 2 * size, 16 * size, 1.8 * size);
    } else if (look.hat === "hood") {
        g.fillStyle = dark ?? shade(look.coat, -20);
        g.beginPath();
        g.arc(0, headY, 7.4 * size, Math.PI * 0.55, Math.PI * 2.05);
        g.lineTo(0, headY);
        g.fill();
    } else if (look.hair) {
        g.fillStyle = dark ?? look.hair;
        g.beginPath();
        g.arc(0, headY - 1.5 * size, 6.2 * size, Math.PI * 1.05, TAU * 0.98);
        g.fill();
    }
    if (look.extra === "moustache") {
        g.fillStyle = "#3b2a1a";
        g.fillRect(2 * size, headY + 2 * size, 5 * size, 1.6 * size);
    }
    if (look.extra === "tie") { // Brille des Schichtleiters
        g.strokeStyle = "#111";
        g.lineWidth = 1.2 * size;
        g.strokeRect(2 * size, headY - 2.5 * size, 4 * size, 3 * size);
    }
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

/** Farbe heller (+) oder dunkler (−) machen. */
export function shade(hex, amount) {
    if (!hex.startsWith("#")) return hex;
    const value = parseInt(hex.slice(1), 16);
    const c = shift => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount));
    return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

export function lookFor(entity) {
    return LOOKS[entity.figure ?? entity.type] ?? LOOKS.schlaeger;
}

// ===========================================================================
// Gegenstände und Effekte
// ===========================================================================

export function drawCrate(g, sx, sy, crate) {
    const w = 22 * SCALE;
    const h = 20 * SCALE;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(sx, sy, 14 * SCALE, 4 * SCALE, 0, 0, TAU);
    g.fill();
    g.fillStyle = crate.hp < 2 ? "#9c6b3c" : "#b7793b";
    g.fillRect(sx - w / 2, sy - h, w, h);
    g.strokeStyle = "#6e4419";
    g.lineWidth = 2 * SCALE;
    g.strokeRect(sx - w / 2, sy - h, w, h);
    line(g, sx - w / 2, sy - h, sx + w / 2, sy, 2 * SCALE, "#6e4419");
    if (crate.hp < 2) line(g, sx - w / 2 + 4, sy - h / 2, sx, sy - h + 3, 2, "#3b2410");
}

export function drawPickup(g, sx, sy, t) {
    const bob = Math.sin(t / 200) * 2 * SCALE;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(sx, sy, 9 * SCALE, 3 * SCALE, 0, 0, TAU);
    g.fill();
    g.font = `${16 * SCALE}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText("🍗", sx, sy - 2 * SCALE + bob);
}

export function drawBottle(g, sx, sy, t) {
    g.save();
    g.translate(sx, sy);
    g.rotate(t / 60);
    g.fillStyle = "#3d8b5a";
    g.fillRect(-2 * SCALE, -6 * SCALE, 4 * SCALE, 12 * SCALE);
    g.restore();
}

/** Warnhinweise des Bosses: Linie beim Ansturm, Kreis beim Stampfer. */
export function drawTelegraph(g, enemy, camX, t) {
    if (enemy.state !== "attack" || !enemy.attack) return;
    const pulse = 0.35 + Math.abs(Math.sin(t / 90)) * 0.35;
    if (enemy.attack.kind === "charge" && enemy.attack.t <= 16) {
        g.fillStyle = `rgba(220, 30, 30, ${pulse * 0.6})`;
        const y = screenY(enemy.z);
        const x = (enemy.x - camX) * SCALE;
        const end = enemy.facing > 0 ? 960 : 0;
        g.fillRect(Math.min(x, end), y - 8 * SCALE, Math.abs(end - x), 16 * SCALE);
    } else if (enemy.attack.kind === "stomp" && enemy.attack.t < 20) {
        g.strokeStyle = `rgba(230, 30, 30, ${pulse + 0.2})`;
        g.fillStyle = `rgba(230, 30, 30, ${pulse * 0.35})`;
        g.lineWidth = 3 * SCALE;
        g.beginPath();
        g.ellipse((enemy.x - camX) * SCALE, screenY(enemy.z), 72 * SCALE, 72 * SCALE / 1.5 * 0.6, 0, 0, TAU);
        g.fill();
        g.stroke();
    } else if (enemy.attack.kind === "punch" && enemy.attack.t < 8) {
        g.font = `bold ${12 * SCALE}px Arial, sans-serif`;
        g.textAlign = "center";
        g.fillStyle = "#ff4d4d";
        g.fillText("!", (enemy.x - camX) * SCALE, screenY(enemy.z, enemy.h + 60 * (enemy.type === "boss" ? 1.45 : enemy.type === "brocken" ? 1.25 : 1)));
    }
}

/** Zahlen und kleine Effekte (Treffer, Heilung, Aufstehen, Kisten). */
export function drawFx(g, fx, age, camX) {
    const k = age / 24;
    const x = (fx.x - camX) * SCALE;
    const y = screenY(fx.z, fx.h) - k * 26 * SCALE;
    g.globalAlpha = Math.max(0, 1 - k);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `bold ${10 * SCALE}px Arial, sans-serif`;
    g.lineWidth = 3 * SCALE;
    g.strokeStyle = "#000";
    if (fx.kind === "hit") {
        if (age < 4) {
            g.fillStyle = "#fff3b0";
            g.beginPath();
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * TAU;
                const r = (i % 2 ? 6 : 13) * SCALE;
                g.lineTo(x + Math.cos(a) * r, screenY(fx.z, fx.h) + Math.sin(a) * r);
            }
            g.fill();
        }
        g.strokeText(`${fx.value}`, x, y);
        g.fillStyle = "#ffd23f";
        g.fillText(`${fx.value}`, x, y);
    } else if (fx.kind === "hurt") {
        g.strokeText(`−${fx.value}`, x, y);
        g.fillStyle = "#ff5c5c";
        g.fillText(`−${fx.value}`, x, y);
    } else if (fx.kind === "heal") {
        g.strokeText(`+${fx.value}`, x, y);
        g.fillStyle = "#6ee07a";
        g.fillText(`+${fx.value}`, x, y);
    } else if (fx.kind === "revive") {
        g.fillStyle = "#ffe066";
        g.fillText("★ ★ ★", x, y);
    } else if (fx.kind === "crate") {
        g.fillStyle = "#b7793b";
        for (let i = 0; i < 5; i++) g.fillRect(x + (i - 2) * 6 * SCALE * (1 + k), y + i * 2, 4 * SCALE, 3 * SCALE);
    }
    g.globalAlpha = 1;
}

export { screenY };
