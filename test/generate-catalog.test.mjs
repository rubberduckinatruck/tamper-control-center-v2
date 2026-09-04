import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
  assert.equal(catalog.summary.total, 1);
  assert.equal(catalog.summary.current, 1);
  assert.deepEqual(catalog.summary.byCategory, { synergy: 1 });
  assert.deepEqual(catalog.scripts[0].tags, ["grading", "sample"]);
  assert.equal(catalog.scripts[0].id, "synergy-sample");
  assert.equal(catalog.scripts[0].name, "Synergy Sample");
  assert.equal(catalog.scripts[0].installedName, "Sample Installed Name");
  assert.equal(catalog.scripts[0].noframes, true);
});

test("reports all missing required Control Center fields", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "control-center-invalid-"));
  const result = spawnSync(process.execPath, [path.join(ROOT, "tools/generate-catalog.mjs"), "--scripts-dir", path.join(ROOT, "test/fixtures/invalid/scripts"), "--archive-dir", path.join(FIXTURE, "archive"), "--drafts-dir", path.join(FIXTURE, "drafts"), "--output", path.join(outputDirectory, "scripts.json")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required @cc-id/);
  assert.match(result.stderr, /missing required @cc-category/);
  assert.match(result.stderr, /missing required @cc-status/);
});
