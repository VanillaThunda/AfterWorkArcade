/**
 * Release: bringt den freigegebenen Stand von "dev" nach "main" und setzt den Versions-Tag.
 *
 * Start (im Ordner dev\, erst NACH der Freigabe):  npm run release
 *
 * Ablauf:
 *  1. Prüfen: dev\ auf Branch dev und sauber, main\ auf Branch main und sauber,
 *     Release-Prüfung (Version > letzter Tag, Changelog-Eintrag, Doku-Version).
 *  2. Alle Tests in dev\ (npm run test:all, inkl. UI-Test).
 *  3. In main\: git merge --no-ff dev  (der pre-merge-commit-Hook prüft erneut)
 *  4. Annotated Tag vX.Y.Z mit dem Changelog-Abschnitt als Beschreibung.
 *  5. In dev\: git merge --ff-only main  (dev wieder auf dem Stand von main)
 */

import { spawnSync } from "node:child_process";
import { git, currentBranch, fail } from "./git/git-utils.mjs";
import { checkWorktree, changelogSection } from "./git/release-check.mjs";

const devRoot = git(["rev-parse", "--show-toplevel"]);

// --- 1. Voraussetzungen -------------------------------------------------------
if (currentBranch(devRoot) !== "dev") {
    fail("npm run release muss im Ordner dev\\ (Branch dev) gestartet werden.");
}
if (git(["status", "--porcelain"], { cwd: devRoot }) !== "") {
    fail("dev\\ hat nicht committete Änderungen – erst committen.", [git(["status", "--short"], { cwd: devRoot })]);
}

const worktrees = git(["worktree", "list", "--porcelain"], { cwd: devRoot }).split(/\n\n/);
const mainEntry = worktrees.find(block => block.includes("branch refs/heads/main"));
if (!mainEntry) fail("Kein Arbeitsordner mit Branch main gefunden (git worktree list).");
const mainRoot = /^worktree (.+)$/m.exec(mainEntry)[1];
if (git(["status", "--porcelain"], { cwd: mainRoot }) !== "") {
    fail(`main\\ (${mainRoot}) hat nicht committete Änderungen.`);
}
if (git(["rev-list", "--count", "main..dev"], { cwd: devRoot }) === "0") {
    fail("dev enthält keine neuen Commits gegenüber main – nichts zu veröffentlichen.");
}

const { version, changelog, errors } = checkWorktree(devRoot);
if (errors.length > 0) fail(`Release ${version} ist nicht vollständig vorbereitet:`, errors);
const tag = `v${version}`;
console.log(`Release ${tag}: Voraussetzungen ok.`);

// --- 2. Alle Tests ------------------------------------------------------------
console.log("\nAlle Tests (npm run test:all) …");
const tests = spawnSync(process.execPath, ["tests/run-all.mjs"], { cwd: devRoot, stdio: "inherit" });
if (tests.status !== 0) fail("Tests fehlgeschlagen – Release abgebrochen.");

// --- 3. Merge nach main -------------------------------------------------------
console.log(`\nMerge dev → main …`);
const merge = spawnSync("git", ["merge", "--no-ff", "dev", "-m", `Release ${tag}`], { cwd: mainRoot, stdio: "inherit" });
if (merge.status !== 0) {
    fail("Merge fehlgeschlagen.", [`Im Ordner ${mainRoot} prüfen (ggf. "git merge --abort").`]);
}

// --- 4. Tag -------------------------------------------------------------------
const notes = changelogSection(changelog, version) ?? "";
git(["tag", "-a", tag, "--cleanup=whitespace", "-F", "-"], { cwd: mainRoot, input: `${tag}\n\n${notes}\n` });

// --- 5. dev nachziehen --------------------------------------------------------
git(["merge", "--ff-only", "main"], { cwd: devRoot });

const commit = git(["rev-parse", "--short", "main"], { cwd: devRoot });
console.log(`\n✔ ${tag} veröffentlicht (main = ${commit}, dev ist auf demselben Stand).`);
console.log("  Syncthing überträgt main\\ auf die Synology – dort den Server neu starten.");
