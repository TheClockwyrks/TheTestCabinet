#!/usr/bin/env node
//
// stage-tcab-packages.mjs — build and stage the shippable Test Cabinet runtime
// libraries into a host **package store**.
//
// The driver image invokes this in a builder stage (see
// deployments/images/driver.Dockerfile) after `npm ci`, writing the staged tree to
// /opt/tcab-packages. The driver seeds each run, and a test case that declares
// `packages` has its named libraries **vendored out of this store into the run
// repository** (under `.tcab/packages/`) at seed time, so the produced tree is
// self-contained; the case's workspace `package.json` depends on each via an
// in-repo relative `file:` path (the harness validates this at resolution but does
// not write it). A built game then consumes a produced asset that needs a runtime
// to play it — a particle `system.json`, a voxel rig — as an ordinary installed
// dependency. See:
//   - containers/README.md#the-shippable-test-cabinet-packages
//   - apps/docs/.../testing/end-to-end/overview.md (Packages)
//
// Each package is staged as a publish-shaped copy: its `package.json` (with
// dev-only fields dropped) plus the files its `files` field publishes (its built
// `dist/`). Any dependency on ANOTHER @test-cabinet package is rewritten to a
// relative `file:` path within the output, and every peer dependency is marked
// optional — so the staged set installs entirely offline, and a 2D consumer is
// never forced to pull a 3D peer (e.g. `three`) it does not import.
//
// Usage: node scripts/stage-tcab-packages.mjs [outDir]   (default /opt/tcab-packages)
//
// The SHIPPABLE list below MUST stay in lockstep with the SHIPPABLE_PACKAGES
// allowlist in crates/core/src/test_case.rs, which is what a case's `packages`
// names are validated against.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The packages a test case may request via its manifest `packages` key. */
const SHIPPABLE = ["@test-cabinet/particle-runtime", "@test-cabinet/voxel-runtime"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? "/opt/tcab-packages");
const packagesDir = join(repoRoot, "packages");

// Map every in-repo package name -> { dir, pkg } by reading packages/*/package.json.
const byName = new Map();
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(packagesDir, entry.name);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (pkg?.name) byName.set(pkg.name, { dir, pkg });
}

// The transitive closure of the shippable packages over their @test-cabinet
// dependencies — everything that must be staged so the set resolves offline.
const closure = new Set();
const visit = (name) => {
  if (closure.has(name)) return;
  const entry = byName.get(name);
  if (!entry) throw new Error(`shippable package ${name} not found under packages/`);
  closure.add(name);
  for (const dep of Object.keys(entry.pkg.dependencies ?? {})) {
    if (dep.startsWith("@test-cabinet/")) visit(dep);
  }
};
for (const name of SHIPPABLE) visit(name);
const members = [...closure];

// Build each package (its `build` script is `tsc -b`, which also builds the
// project references it depends on), so `dist/` is present to stage.
console.log(`building ${members.join(", ")}`);
execFileSync("npm", ["run", "build", ...members.flatMap((n) => ["-w", n]), "--if-present"], {
  cwd: repoRoot,
  stdio: "inherit",
});

// Stage each package into outDir/<name> (the name carries its @scope).
rmSync(outDir, { recursive: true, force: true });
for (const name of members) {
  const { dir, pkg } = byName.get(name);
  const dest = join(outDir, name);
  mkdirSync(dest, { recursive: true });

  // Rewrite the manifest for offline consumption: drop dev-only fields, repoint
  // each @test-cabinet dependency at its staged sibling via a relative `file:`
  // path, and make every peer optional (a game provides its own three, etc.).
  const staged = { ...pkg };
  delete staged.private;
  delete staged.scripts;
  delete staged.devDependencies;
  if (staged.dependencies) {
    staged.dependencies = Object.fromEntries(
      Object.entries(staged.dependencies).map(([dep, spec]) => {
        if (!dep.startsWith("@test-cabinet/")) return [dep, spec];
        if (!closure.has(dep)) {
          throw new Error(`${name} depends on un-staged package ${dep}`);
        }
        const rel = relative(dest, join(outDir, dep)) || ".";
        return [dep, `file:${rel}`];
      }),
    );
  }
  if (staged.peerDependencies) {
    staged.peerDependenciesMeta = { ...staged.peerDependenciesMeta };
    for (const peer of Object.keys(staged.peerDependencies)) {
      staged.peerDependenciesMeta[peer] = { ...staged.peerDependenciesMeta[peer], optional: true };
    }
  }
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(staged, null, 2)}\n`);

  // Copy the files the package publishes (default ["dist"]).
  for (const file of pkg.files ?? ["dist"]) {
    const src = join(dir, file);
    if (!existsSync(src)) {
      throw new Error(`${name} declares files entry "${file}" but ${src} does not exist`);
    }
    cpSync(src, join(dest, file), { recursive: true });
  }
  console.log(`staged ${name} -> ${dest}`);
}

console.log(`done: ${members.length} package(s) staged into ${outDir}`);
