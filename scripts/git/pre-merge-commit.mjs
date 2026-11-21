/**
 * pre-merge-commit-Hook: Bevor ein Merge-Commit auf "main" entsteht, wird geprüft,
 *  1. ob das Release vollständig vorbereitet ist (Version, Changelog, Doku) und
 *  2. ob die schnellen Tests bestehen (API, Revierkampf-, Schocken-, Mäxchen- und Lichtrenner-Logik, ~7 s).
 * Auf anderen Branches passiert nichts. Der volle Testlauf (inkl. UI) läuft vorher
 * in scripts/release.mjs im Ordner dev\.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { git, currentBranch, fail } from "./git-utils.mjs";
import { checkWorktree } from "./release-check.mjs";

const root = git(["rev-parse", "--show-toplevel"]);
if (currentBranch(root) !== "main") process.exit(0);

const { version, errors } = checkWorktree(root);
if (errors.length > 0) fail(`Merge nach main abgebrochen – Release ${version} ist nicht vollständig:`, errors);

console.log(`Merge nach main (v${version}): schnelle Tests …`);
for (const file of ["api.test.mjs", "revierkampf.test.mjs", "schocken.test.mjs", "maexchen.test.mjs", "lichtrenner.test.mjs", "bombenlabyrinth.test.mjs"]) {
    const result = spawnSync(process.execPath, [path.join(root, "tests", file)], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) {
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        fail(`Merge nach main abgebrochen – ${file} ist fehlgeschlagen.`);
    }
    console.log(`  ✔ ${file}`);
}
