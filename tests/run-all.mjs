/**
 * Führt alle Tests nacheinander aus.
 *
 * Start:  npm run test:all   bzw.  node tests/run-all.mjs
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TESTS = ["git.test.mjs", "api.test.mjs", "revierkampf.test.mjs", "schocken.test.mjs", "maexchen.test.mjs", "lichtrenner.test.mjs", "bombenlabyrinth.test.mjs", "reconnect.test.mjs", "ui.test.mjs"];
const failed = [];

for (const file of TESTS) {
    console.log(`\n========== ${file} ==========`);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { stdio: "inherit" });
    if (result.status !== 0) failed.push(file);
}

console.log("\n==============================");
console.log(failed.length === 0 ? "Alle Tests bestanden." : `Fehlgeschlagen: ${failed.join(", ")}`);
process.exit(failed.length === 0 ? 0 : 1);
