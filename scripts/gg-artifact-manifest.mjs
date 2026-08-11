#!/usr/bin/env node
/**
 * Write the manifest that says which sources a committed gg language artifact was built from.
 *
 * Six of gg's eleven language arms commit a binary that a person rebuilds **by hand**: the
 * TypeScript, Python and Ruby guest components (`crates/gg/src/sandbox/guests/*.component.wasm`,
 * 14-25 MB each), and the Rust, Swift and C++ compile inputs
 * (`crates/gg/src/sandbox/checkers/*.tar.gz`, plus the two preview1 adapters). None of the six is
 * re-cut by `scripts/ci/contract-drift.sh`, and for good reasons it states at length: the builds
 * want `componentize-js`, `componentize-py`, a ~200 MB wasi-sdk or an ~835 MB Swift toolchain, and
 * two of the six are not byte-reproducible, so a drift check that rebuilt them would fail on every
 * run.
 *
 * That leaves one silent and expensive way for the checkout and the artifact to disagree: a source
 * edited without a rebuild, which leaves every program of that arm evaluated by — or compiled
 * against — the artifact that was committed, while the source in front of a reader says something
 * else. The catalogue is emphatically on the reader's side of that gap rather than the artifact's:
 * `crates/gg/build.rs` reflects it out of the SDK on every build, so what a model is *told* moves
 * the moment the source does, and the hand-built binary is the one thing left that can stay
 * behind — which sharpens the need for this manifest rather than softening it. The checks that do inspect these artifacts
 * today either compare **tool names** (`bound-tools`, which a change to a guest's scope, refusals or
 * argument handling leaves untouched) or compare the few sources an archive happens to carry
 * verbatim (the C++ headers, the Swift shell), which is most of an arm's SDK on one arm and none of
 * it on another.
 *
 * So each build writes a digest of everything that went into its artifacts, beside them, and
 * `crates/gg/src/sandbox/language/artifacts.test.rs` recomputes those digests from the checkout and
 * fails **by arm name**. It converts "a reviewer forgot to run `build.sh`" from an invisible
 * correctness hole into a named test failure.
 *
 * **What this proves, and what it does not.** It proves an artifact matches the sources recorded
 * beside it. It does not prove the artifact was built *correctly* from them — that the build script
 * compiled what it meant to, that the guest behaves as the SDK reads. That is what the per-arm
 * substrate and compile tests are for, and this manifest neither replaces nor weakens one of them.
 *
 * **The build script is a source.** Every caller passes its own `build.sh` as a `--source-file`,
 * because the recipe goes into the artifact as surely as the tree does: the `--disable`d WASI
 * capabilities of two guests, the exception-handling and hardening flags of the C++ arm, the module
 * list of the Swift one, and the bindings flags of the Rust one all live in a build script and in no
 * source it reads. An edit to one of them without a re-run therefore fails the gate, and that is the
 * intended reading — editing the recipe and not cooking is exactly the state this exists to name.
 *
 * `--ignore` is the counterpart, and it is for **generated** paths under a source root: CPython's
 * bytecode cache, the Rust arm's `src/bindings.rs`. Both are `.gitignore`d, so hashing one would
 * fail the gate on every fresh checkout — a failure nobody could act on and everybody would learn to
 * silence. What generates them goes in as a `--source-file` instead.
 *
 * Usage:
 *   node scripts/gg-artifact-manifest.mjs \
 *     --arm typescript \
 *     --rebuild packages/gg-sandbox/build.sh \
 *     --artifact crates/gg/src/sandbox/guests/typescript.component.wasm \
 *     --source-root packages/gg-sandbox/src \
 *     --source-file packages/gg-sandbox/tsconfig.json \
 *     --source-file packages/gg-sandbox/build.sh \
 *     --wit crates/gg/wit \
 *     --pin componentizeJs=0.21.0 \
 *     --out crates/gg/src/sandbox/guests/typescript.component.manifest.json
 *
 * Every flag but `--arm`, `--rebuild`, `--wit` and `--out` may be repeated. Paths may be absolute or
 * relative to anywhere; they are recorded relative to the repository root, so a manifest reads the
 * same whichever directory the build was started from.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, from this script's own location rather than from the caller's directory. */
const REPOSITORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** A path as the manifest records it: relative to the repository, with forward slashes. */
function relative(target) {
  return path.relative(REPOSITORY, path.resolve(REPOSITORY, target));
}

/** Everything the caller asked for, parsed out of `--flag value` pairs. */
function options(argv) {
  const parsed = {
    arm: undefined,
    rebuild: undefined,
    artifacts: [],
    roots: [],
    files: [],
    ignore: [],
    wit: undefined,
    pins: {},
    out: undefined,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--arm") parsed.arm = value;
    else if (flag === "--rebuild") parsed.rebuild = relative(value);
    else if (flag === "--artifact") parsed.artifacts.push(relative(value));
    else if (flag === "--source-root") parsed.roots.push(relative(value));
    else if (flag === "--source-file") parsed.files.push(relative(value));
    else if (flag === "--ignore") parsed.ignore.push(relative(value));
    else if (flag === "--wit") parsed.wit = relative(value);
    else if (flag === "--out") parsed.out = value;
    else if (flag === "--pin") {
      const at = value.indexOf("=");
      if (at < 0) throw new Error(`--pin wants name=value, got ${value}`);
      parsed.pins[value.slice(0, at)] = value.slice(at + 1);
    } else throw new Error(`unknown flag ${flag}`);
  }
  const missing = ["arm", "rebuild", "wit", "out"].filter(
    (name) => !parsed[name],
  );
  if (missing.length > 0 || parsed.artifacts.length === 0) {
    throw new Error(
      "--arm, --rebuild, --wit, --out and at least one --artifact are all required",
    );
  }
  if (parsed.roots.length === 0 && parsed.files.length === 0) {
    throw new Error("a manifest with no sources would assert nothing");
  }
  return parsed;
}

/**
 * Every file under `root`, relative to the repository, sorted.
 *
 * Sorted because the manifest is committed and read by a human in a diff, and because an unsorted
 * object would churn on nothing but a directory listing's order. Directories a build generates are
 * skipped through `--ignore`: what the manifest is about is the source a person edits.
 */
async function walk(root, ignore) {
  const found = [];
  const visit = async (dir) => {
    for (const entry of await readdir(path.join(REPOSITORY, dir), {
      withFileTypes: true,
    })) {
      const full = path.join(dir, entry.name);
      if (ignore.some((skip) => full === skip || full.startsWith(`${skip}/`)))
        continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  await visit(root);
  return found.sort();
}

/** The SHA-256 of a file's bytes, hex-encoded. */
async function digest(file) {
  return createHash("sha256")
    .update(await readFile(path.join(REPOSITORY, file)))
    .digest("hex");
}

/**
 * A digest over the WIT's **declarations**, deliberately blind to its documentation.
 *
 * Every one of these artifacts is built against `crates/gg/wit`, through generated bindings that
 * are not committed anywhere a source digest would see them, so the wire has to be in the manifest
 * or a renamed function would be a rebuild nothing asked for. But that one file is also gg's
 * membrane documentation — 858 of its 1,219 lines are prose — and holding a 25 MB rebuild hostage
 * to a reworded comment would teach whoever hit it to regenerate the manifest without rebuilding,
 * which is the one habit that would make this whole mechanism worthless.
 *
 * So the digest is taken over the lines that are not blank and do not begin a `//` comment, each
 * trimmed, joined with newlines under its file's name. Reindenting is not a rebuild either. gg's
 * WIT uses no block comments (measured: zero occurrences of an opening one), and if one ever
 * appeared it would be hashed as a declaration — which fails in the safe direction, an extra
 * rebuild rather than a missed one.
 */
async function wireDigest(root) {
  const hash = createHash("sha256");
  for (const file of await walk(root, [])) {
    if (!file.endsWith(".wit")) continue;
    const text = await readFile(path.join(REPOSITORY, file), "utf8");
    const declarations = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    hash.update(`${file}\n${declarations.join("\n")}\n`);
  }
  return hash.digest("hex");
}

const parsed = options(process.argv.slice(2));

const artifacts = {};
for (const artifact of parsed.artifacts) {
  artifacts[artifact] = {
    bytes: (await stat(path.join(REPOSITORY, artifact))).size,
    sha256: await digest(artifact),
  };
}

const sources = {};
for (const root of parsed.roots)
  for (const file of await walk(root, parsed.ignore))
    sources[file] = await digest(file);
for (const file of parsed.files.sort()) sources[file] = await digest(file);

const manifest = {
  // The arm this describes, because the failure worth having is one that says which of eleven.
  arm: parsed.arm,
  // The command that rewrites all of this, quoted verbatim in the test's failure message so nobody
  // has to go looking for it.
  rebuild: parsed.rebuild,
  // What was produced, so a manifest regenerated without its artifacts (or the reverse) cannot be
  // mistaken for a description of what is committed.
  artifacts,
  // The wire everything here was built against — see `wireDigest` for what it deliberately ignores.
  wit: { root: parsed.wit, declarationsSha256: await wireDigest(parsed.wit) },
  // The toolchain the artifacts were built at. A bump here without a rebuild is a manifest
  // describing something else's output, which is as much a lie as a stale source digest.
  pins: parsed.pins,
  // Every source that went in, by its repository-relative path. The Rust test walks the same roots,
  // so a file ADDED to an SDK and never built in fails as an extra path rather than being missed.
  sources,
};

await writeFile(parsed.out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${parsed.out} (${Object.keys(artifacts).length} artifacts, ${Object.keys(sources).length} sources).`,
);
