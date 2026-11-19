/**
 * pre-commit-Hook:
 *  1. Keine direkten Commits auf "main" – main bekommt Änderungen nur per Merge aus "dev"
 *     (Ausnahme: Abschluss eines Merges mit Konflikten, erkennbar an MERGE_HEAD).
 *  2. Syntaxprüfung aller gestagten .js/.mjs/.cjs-Dateien per "node --check".
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, currentBranch, fail } from "./git-utils.mjs";

const root = git(["rev-parse", "--show-toplevel"]);

// --- 1. main schützen --------------------------------------------------------
if (currentBranch(root) === "main") {
    const mergeHead = path.resolve(root, git(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: root }));
    if (!fs.existsSync(mergeHead)) {
        fail("Direkte Commits auf \"main\" sind nicht erlaubt.", [
            "Änderungen im Ordner dev\\ (Branch dev) committen.",
            "Nach der Freigabe: npm run release (merged dev → main und setzt den Tag)."
        ]);
    }
}

// --- 2. Syntax der gestagten JavaScript-Dateien ------------------------------
const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACM"], { cwd: root })
    .split("\n")
    .filter(file => /\.(m|c)?js$/.test(file));

const errors = [];
for (const file of staged) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    if (result.status !== 0) {
        const message = (result.stderr || "").split("\n").find(line => /Error/.test(line)) ?? "Syntaxfehler";
        errors.push(`${file}: ${message.trim()}`);
    }
}
if (errors.length > 0) fail("Syntaxfehler in gestagten Dateien:", errors);
