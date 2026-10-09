// The staged manifests name nothing a model must not learn.
//
// A package staged by stage-tcab-packages.mjs is vendored into a model's workspace,
// its `package.json` included, so the manifest is held to the strict vocabulary
// list that scripts/ci/seeded-contract-check.sh holds the generated asset contract
// to. A manifest published to the project's feed carries the feed's URL
// (`publishConfig`) and the project's `repository`, `homepage` and `bugs`, so the
// staging script drops them; this stages the real closure and reads every manifest
// it wrote.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read from the gate rather than copied, so the two lists cannot drift.
const strict = (() => {
  const gate = readFileSync(
    join(repoRoot, "scripts/ci/seeded-contract-check.sh"),
    "utf8",
  );
  const source = gate.match(/^readonly STRICT='([^']+)'$/m)?.[1];
  assert.ok(source, "could not read STRICT from seeded-contract-check.sh");
  return new RegExp(source, "i");
})();

// The validator harness is staged into the same store but never seeded into a run
// workspace (the reporter reads it once the container is gone), and its own name
// is a word the list bans, so it is the one manifest the list does not apply to.
const NEVER_SEEDED = new Set(["@clockwyrks/case-harness"]);

const REGISTRY_FIELDS = ["publishConfig", "repository", "homepage", "bugs"];

let outDir;
let manifests;

before(() => {
  outDir = mkdtempSync(join(tmpdir(), "stage-tcab-packages-"));
  execFileSync(
    process.execPath,
    [
      join(repoRoot, "scripts/stage-tcab-packages.mjs"),
      "--manifests-only",
      outDir,
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
  manifests = readdirSync(outDir, { recursive: true })
    .filter((path) => path.split(/[\\/]/).at(-1) === "package.json")
    .map((path) => ({ path, text: readFileSync(join(outDir, path), "utf8") }));
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test("the closure is staged, the asset contract with it", () => {
  const names = manifests.map(({ text }) => JSON.parse(text).name);
  assert.ok(names.includes("@clockwyrks/voxel-runtime"), names.join(", "));
  assert.ok(names.includes("@clockwyrks/asset-contract"), names.join(", "));
});

test("no staged manifest keeps a registry field", () => {
  for (const { path, text } of manifests) {
    const manifest = JSON.parse(text);
    for (const field of REGISTRY_FIELDS) {
      assert.ok(!(field in manifest), `${path} keeps ${field}`);
    }
  }
});

test("no seeded manifest names what a model must not learn", () => {
  for (const { path, text } of manifests) {
    if (NEVER_SEEDED.has(JSON.parse(text).name)) continue;
    const hits = text.split("\n").filter((line) => strict.test(line));
    assert.deepEqual(hits, [], `${path} names what a model must not learn`);
  }
});
