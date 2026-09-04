import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, "..");
const FIXTURE = path.join(ROOT, "test/fixtures/catalog");

function generate(outputDirectory) {
  return spawnSync(process.execPath, [path.join(ROOT, "tools/generate-catalog.mjs"), "--scripts-dir", path.join(FIXTURE, "scripts"), "--archive-dir", path.join(FIXTURE, "archive"), "--drafts-dir", path.join(FIXTURE, "drafts"), "--output", path.join(outputDirectory, "scripts.json")], { encoding: "utf8" });
}

test("generates a normalized deterministic v2 catalog", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "control-center-catalog-"));
  const first = generate(outputDirectory);
  assert.equal(first.status, 0, first.stderr);
  const firstText = await readFile(path.join(outputDirectory, "scripts.json"), "utf8");
  const second = generate(outputDirectory);
  assert.equal(second.status, 0, second.stderr);
  const secondText = await readFile(path.join(outputDirectory, "scripts.json"), "utf8");
  assert.equal(firstText, secondText);
  const catalog = JSON.parse(firstText);
  assert.equal(catalog.schemaVersion, 2);
  assert.deepEqual(catalog.build, { scanned: 1, published: 1, skipped: 0, warnings: 0, draftsValidated: 0 });
  assert.equal(catalog.summary.total, 1);
  assert.equal(catalog.summary.current, 1);
  assert.deepEqual(catalog.summary.byCategory, { synergy: 1 });
  assert.deepEqual(catalog.scripts[0].tags, ["grading", "sample"]);
  assert.equal(catalog.scripts[0].id, "synergy-sample");
  assert.equal(catalog.scripts[0].name, "Synergy Sample");
  assert.equal(catalog.scripts[0].installedName, "Sample Installed Name");
  assert.equal(catalog.scripts[0].noframes, true);
});

test("publishes a flat scripts file using its metadata category", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "control-center-flat-"));
  const scriptsDirectory = path.join(temporaryRoot, "scripts");
  const outputFile = path.join(temporaryRoot, "scripts.json");
  const scriptFile = path.join(scriptsDirectory, "flat-example.user.js");
  await mkdir(scriptsDirectory);
  const config = JSON.parse(await readFile(path.join(ROOT, "catalog.config.json"), "utf8"));
  const repositoryPath = path.relative(ROOT, scriptFile).split(path.sep).join("/");
  const rawUrl = `${config.repository.rawBaseUrl}/${repositoryPath}`;
  await writeFile(scriptFile, `// ==UserScript==
// @name             Flat Example
// @version          1.0.0
// @description      Tests metadata-authoritative flat-file categories.
// @cc-id            flat-example
// @cc-display-name  Flat Example
// @cc-category      synergy
// @cc-role          teaching
// @cc-status        live
// @cc-tags          flat, test
// @match            https://example.com/*
// @grant            none
// @updateURL        ${rawUrl}
// @downloadURL      ${rawUrl}
// ==/UserScript==
(() => {})();
`, "utf8");
  const result = spawnSync(process.execPath, [path.join(ROOT, "tools/generate-catalog.mjs"), "--scripts-dir", scriptsDirectory, "--archive-dir", path.join(temporaryRoot, "archive"), "--drafts-dir", path.join(temporaryRoot, "drafts"), "--output", outputFile], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(await readFile(outputFile, "utf8"));
  assert.equal(catalog.build.published, 1);
  assert.equal(catalog.build.skipped, 0);
  assert.equal(catalog.scripts[0].category, "synergy");
  assert.equal(catalog.scripts[0].file, repositoryPath);
});

test("skips scripts with missing metadata without failing the catalog", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "control-center-invalid-"));
  const result = spawnSync(process.execPath, [path.join(ROOT, "tools/generate-catalog.mjs"), "--scripts-dir", path.join(ROOT, "test/fixtures/invalid/scripts"), "--archive-dir", path.join(FIXTURE, "archive"), "--drafts-dir", path.join(FIXTURE, "drafts"), "--output", path.join(outputDirectory, "scripts.json")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /missing required @cc-id/);
  assert.match(result.stderr, /missing required @cc-category/);
  assert.match(result.stderr, /missing required @cc-status/);
  const catalog = JSON.parse(await readFile(path.join(outputDirectory, "scripts.json"), "utf8"));
  assert.equal(catalog.build.scanned, 1);
  assert.equal(catalog.build.published, 0);
  assert.equal(catalog.build.skipped, 1);
  assert.equal(catalog.scripts.length, 0);
  assert.match(catalog.migrationNotice, /1 userscript is awaiting valid metadata/);
});
