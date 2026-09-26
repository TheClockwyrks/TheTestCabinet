#!/usr/bin/env node
//
// stage-tcab-packages.mjs — build and stage the shippable Test Cabinet runtime
// libraries into a host **package store**.
//
// The driver image invokes this in a builder stage (see
// deployments/images/driver.Dockerfile) after `npm ci`, writing the staged tree to
// /opt/tcab-packages. The driver seeds each run, and a test case that declares
// `packages` has its named libraries **vendored out of this store into the run
// repository** (under `.vendor/packages/`) at seed time, so the produced tree is
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
// `dist/`). Any dependency on ANOTHER @clockwyrks package is rewritten to a
// relative `file:` path within the output, and every peer dependency is marked
// optional — so the staged set installs entirely offline, and a 2D consumer is
// never forced to pull a 3D peer (e.g. `three`) it does not import.
//
// Usage: node scripts/stage-tcab-packages.mjs [outDir]   (default /opt/tcab-packages)
//
// The SHIPPABLE list below is the superset of the SHIPPABLE_PACKAGES allowlist in
// crates/core/src/test_case.rs. That allowlist is what a case's manifest `packages`
// names are validated against, so every name a case may request must appear in both
// lists. The extra entries here are ENGINE runtimes (@clockwyrks/simple-2d,
// @clockwyrks/structured-2d, @clockwyrks/simple-3d, @clockwyrks/structured-3d) and the shared validator harness
// (@clockwyrks/case-harness).
// They are staged into the same store, but an engine is a run dimension selected
// per run (`tcab run --engine <slug>`) rather than something a case declares, and
// it is seeded into `.vendor/engine/` rather than `.vendor/packages/`. So an engine
// runtime belongs in this list and must NOT be added to SHIPPABLE_PACKAGES —
// adding it there would let a case request the engine through `packages`, which
// is exactly what that allowlist exists to refuse. The validator harness is out of
// that allowlist for a sharper reason still: nothing seeds it into a run repository
// at all. It is read from this store AFTER the container is gone, by crates/core's
// vitest validator, which copies its sources into the staged validator project — so
// a case able to name it through `packages` would put the tests it is measured by in
// front of the model.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything staged into the package store. The first two are the packages a test
 * case may request via its manifest `packages` key, and those two MUST also appear
 * in SHIPPABLE_PACKAGES in crates/core/src/test_case.rs. The rest are engine
 * runtimes and the shared validator harness: never nameable by a case — so they are
 * staged from here and are deliberately absent from that Rust allowlist.
 *
 * Every name here must also survive the root .dockerignore ALLOWLIST, or the
 * services image's package-store stage (`COPY . .`, then this script) dies on a
 * package that is not in the build context. scripts/ci/build-context.sh asserts it.
 */
const SHIPPABLE = [
  "@clockwyrks/particle-runtime",
  "@clockwyrks/voxel-runtime",
  // Engine runtimes — staged, but not `packages` names. See above.
  "@clockwyrks/simple-2d",
  "@clockwyrks/structured-2d",
  "@clockwyrks/simple-3d",
  "@clockwyrks/structured-3d",
  // The shared engineless (`none`) validator harness and canvas recorder. It has no
  // build step and publishes `"files": ["src"]`, so what lands in the store is its
  // TypeScript source — which is what the vitest validator copies into a staged
  // validator project for vitest to transpile, exactly as it transpiles the case's
  // own suites. Read post-container by the reporter; never seeded into a run.
  "@clockwyrks/case-harness",
];

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

// The transitive closure of the shippable packages over their @clockwyrks
// dependencies — everything that must be staged so the set resolves offline.
const closure = new Set();
const visit = (name) => {
  if (closure.has(name)) return;
  const entry = byName.get(name);
  if (!entry)
    throw new Error(`shippable package ${name} not found under packages/`);
  closure.add(name);
  for (const dep of Object.keys(entry.pkg.dependencies ?? {})) {
    if (dep.startsWith("@clockwyrks/")) visit(dep);
  }
};
for (const name of SHIPPABLE) visit(name);
const members = [...closure];

// Build each package (its `build` script is `tsc -b`, which also builds the
// project references it depends on), so `dist/` is present to stage.
console.log(`building ${members.join(", ")}`);
execFileSync(
  "npm",
  ["run", "build", ...members.flatMap((n) => ["-w", n]), "--if-present"],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

// Stage each package into outDir/<name> (the name carries its @scope).
rmSync(outDir, { recursive: true, force: true });
for (const name of members) {
  const { dir, pkg } = byName.get(name);
  const dest = join(outDir, name);
  mkdirSync(dest, { recursive: true });

  // Rewrite the manifest for offline consumption: drop dev-only fields, repoint
  // each @clockwyrks dependency at its staged sibling via a relative `file:`
  // path, and make every peer optional (a game provides its own three, etc.).
  const staged = { ...pkg };
  delete staged.private;
  delete staged.scripts;
  delete staged.devDependencies;
  if (staged.dependencies) {
    staged.dependencies = Object.fromEntries(
      Object.entries(staged.dependencies).map(([dep, spec]) => {
        if (!dep.startsWith("@clockwyrks/")) return [dep, spec];
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
      staged.peerDependenciesMeta[peer] = {
        ...staged.peerDependenciesMeta[peer],
        optional: true,
      };
    }
  }
  writeFileSync(
    join(dest, "package.json"),
    `${JSON.stringify(staged, null, 2)}\n`,
  );

  // Copy the files the package publishes (default ["dist"]).
  for (const file of pkg.files ?? ["dist"]) {
    const src = join(dir, file);
    if (!existsSync(src)) {
      throw new Error(
        `${name} declares files entry "${file}" but ${src} does not exist`,
      );
    }
    cpSync(src, join(dest, file), { recursive: true });
  }
  console.log(`staged ${name} -> ${dest}`);
}

console.log(`done: ${members.length} package(s) staged into ${outDir}`);
