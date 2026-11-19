/**
 * Kleine Helfer für die Git-Skripte (Hooks und Release). Nur Node-Bordmittel.
 */

import { spawnSync } from "node:child_process";

/** Führt einen Git-Befehl aus und liefert die Ausgabe (getrimmt). Wirft bei Fehlern. */
export function git(args, { cwd = process.cwd(), input } = {}) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", input });
    if (result.error) throw new Error(`git konnte nicht gestartet werden: ${result.error.message}`);
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} fehlgeschlagen:\n${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout.trim();
}

/** Aktueller Branch-Name (bzw. "HEAD", wenn kein Branch ausgecheckt ist). */
export function currentBranch(cwd) {
    return git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
}

/** Gibt eine Fehlermeldung aus und beendet den Prozess mit Exit-Code 1. */
export function fail(title, details = []) {
    console.error(`\n✖ ${title}`);
    for (const line of details) console.error(`  - ${line}`);
    console.error("");
    process.exit(1);
}
