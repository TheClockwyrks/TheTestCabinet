// Render an asset-generation reference implementation locally, so its sprites can
// be looked at without publishing them.
//
// A reference implementation for an asset case is a `draw.sh` of drawing-binary
// calls (see `testing/asset-generation/manifests.md`); the images and the action
// logs it produces are deliberately NOT committed, because the script reproduces
// them exactly. That is the right trade for the repository, but it leaves an author
// with nothing to look at while iterating. This script closes that gap: it seeds a
// workspace from the case manifest, runs the script exactly as
// `tcab publish-reference` would, and writes out the per-frame images, the action
// logs, and the animated GIFs the console shows for a run of the same case.
//
// The GIFs are produced with the **same encoder and the same parameters** as the
// console's own download button (`packages/ui/src/app/pages/runs/[runId]/spriteGif.ts`)
// — `gifenc`, the same integer upscale, the same per-frame delay, and the same
// 1-bit-alpha quantization — so what you see here is what a reviewer sees, not an
// approximation of it. Keep the two in step if either changes.
//
// Usage:
//   node scripts/preview-asset-reference.mjs <slug>
//   node scripts/preview-asset-reference.mjs <path/to/reference-impl/<variant>/draw.sh>
//   node scripts/preview-asset-reference.mjs <slug> --variant <variant>
//   node scripts/preview-asset-reference.mjs <slug> --version v1.0.0
//
// Output lands in `tmp/asset-previews/<slug>/<variant>/` — inside the repo so it is
// one click away in an editor, and already ignored (`tmp/` is in .gitignore), so a
// preview can never be committed by accident.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// gifenc ships CommonJS, so its exports arrive on the default binding rather than
// as named ones (the console imports it through a bundler, which papers over this).
import gifenc from "gifenc";
import sharp from "sharp";
import * as toml from "smol-toml";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OUTPUT_ROOT = path.join(REPO_ROOT, "tmp", "asset-previews");

// Mirrors `TARGET_LONGEST_SIDE` in the console's `spriteGif.ts`. Sprites are tiny;
// an exported loop is scaled up so it is legible rather than a 16-px speck.
const TARGET_LONGEST_SIDE = 256;

// The two asset kinds this script can render. The other kinds (voxel, mesh,
// skinned, particle, audio, blender) produce something other than a flat frame
// sequence and would each need their own viewer.
const SUPPORTED_KINDS = new Set(["sprite", "sprite-sheet"]);

function main() {
  const { target, variantArg, versionArg } = parseArgs(process.argv.slice(2));

  const { versionDir, scriptPath, variant } = resolveTarget(
    target,
    variantArg,
    versionArg,
  );
  const manifest = toml.parse(
    fs.readFileSync(path.join(versionDir, "test-case.toml"), "utf8"),
  );

  if (manifest.type !== "asset-generation") {
    fail(
      `\`${manifest.slug}\` is a ${manifest.type} case; only asset-generation cases have a draw.sh reference.`,
    );
  }
  const kind = manifest.asset_kind ?? "sprite";
  if (!SUPPORTED_KINDS.has(kind)) {
    fail(
      `\`${manifest.slug}\` is an ${kind} case. This script renders only ${[...SUPPORTED_KINDS].join(" / ")} cases, ` +
        `which are the kinds whose output is a flat frame sequence.`,
    );
  }
  if (!fs.existsSync(scriptPath)) {
    fail(`no draw.sh at ${rel(scriptPath)}`);
  }

  const outDir = path.join(OUTPUT_ROOT, manifest.slug, variant);
  // Rebuilt wholesale each run, so a frame that a script stopped drawing cannot
  // linger and be mistaken for current output.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const layout = seedWorkspace(outDir, manifest, kind);
  const binDir = resolveBinaryDir(manifest.tool.binary);

  console.log(`${manifest.slug} (${variant}) — ${manifest.name ?? ""}`);
  console.log(`  script: ${rel(scriptPath)}`);
  console.log(`  binary: ${path.join(binDir, manifest.tool.binary)}`);

  runInWorkspace(outDir, binDir, [manifest.tool.binary, "init"]);
  runInWorkspace(outDir, binDir, ["sh", scriptPath]);

  const missing = layout.frames.filter(
    (f) => !fs.existsSync(path.join(outDir, f.image)),
  );
  if (missing.length > 0) {
    fail(
      `the script left no image for frame(s) ${missing.map((f) => f.index).join(", ")}. ` +
        `Every frame the manifest declares must be drawn.`,
    );
  }
  console.log(`  drew ${layout.frames.length} frame(s)`);

  return { manifest, kind, variant, outDir, layout, scriptPath };
}

/** Parse the positional target plus the two optional selectors. */
function parseArgs(argv) {
  let target = null;
  let variantArg = null;
  let versionArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--variant") variantArg = argv[++i];
    else if (arg === "--version") versionArg = argv[++i];
    else if (arg === "-h" || arg === "--help") usage(0);
    else if (arg.startsWith("-")) fail(`unknown option \`${arg}\``);
    else if (target === null) target = arg;
    else fail(`unexpected argument \`${arg}\``);
  }
  if (!target) usage(1);
  return { target, variantArg, versionArg };
}

/**
 * Work out which case version, which variant, and which script to run.
 *
 * A path to a `draw.sh` is resolved by walking up to the version folder that owns
 * it, so the manifest that seeded it is always the one that governs it. A bare slug
 * is looked up in the catalog instead, taking the newest version unless one is named.
 */
function resolveTarget(target, variantArg, versionArg) {
  if (target.endsWith(".sh") || fs.existsSync(target)) {
    const scriptPath = path.resolve(target);
    const versionDir = findVersionDir(scriptPath);
    if (!versionDir) {
      fail(
        `${rel(scriptPath)} is not inside a test-case version folder (no test-case.toml above it).`,
      );
    }
    // .../<version>/reference-impl/<variant>/draw.sh
    const variant = variantArg ?? path.basename(path.dirname(scriptPath));
    return { versionDir, scriptPath, variant };
  }

  const versionDir = findCaseVersion(target, versionArg);
  const variant = variantArg ?? defaultVariant(versionDir);
  const scriptPath = path.join(
    versionDir,
    "reference-impl",
    variant,
    "draw.sh",
  );
  return { versionDir, scriptPath, variant };
}

/** Walk up from a path to the nearest directory holding a `test-case.toml`. */
function findVersionDir(from) {
  let dir = path.dirname(from);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "test-case.toml"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** Locate `test-cases/**\/<slug>/<version>/`, newest version unless one is named. */
function findCaseVersion(slug, versionArg) {
  const root = path.join(REPO_ROOT, "test-cases");
  const matches = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === slug) matches.push(child);
      else walk(child, depth + 1);
    }
  };
  walk(root, 0);
  if (matches.length === 0) fail(`no test case \`${slug}\` under test-cases/`);

  const caseDir = matches[0];
  const versions = fs
    .readdirSync(caseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("v"))
    .map((e) => e.name)
    .sort();
  if (versions.length === 0) fail(`\`${slug}\` has no version folders`);

  const version = versionArg ?? versions[versions.length - 1];
  const versionDir = path.join(caseDir, version);
  if (!fs.existsSync(versionDir))
    fail(`\`${slug}\` has no version \`${version}\``);
  return versionDir;
}

/** The manifest's first listed variant — the default one, as `tcab run` uses. */
function defaultVariant(versionDir) {
  const manifest = toml.parse(
    fs.readFileSync(path.join(versionDir, "test-case.toml"), "utf8"),
  );
  const first = (manifest.variants ?? [])[0];
  if (!first) return "base";
  const variant = toml.parse(
    fs.readFileSync(path.join(versionDir, first), "utf8"),
  );
  return variant.slug ?? "base";
}

/**
 * Write the drawing scaffold the script expects to find already in place: the
 * config the binary reads, an empty layer document, and (via the binary's own
 * `init`, run by the caller) a blank preview and empty log per declared frame.
 *
 * This mirrors `seed_asset_tool` in `crates/core/src/seeding.rs`. It is deliberately
 * derived from the manifest rather than hard-coded, for the same reason the real
 * seeding is: a script must never restate its case's canvas or frame count, so the
 * only way a mismatch can surface is if the config comes from the manifest.
 */
function seedWorkspace(outDir, manifest, kind) {
  const canvas = manifest.canvas;
  const preview = manifest.tool.preview;
  const actions = manifest.output.actions;
  const isSheet = kind === "sprite-sheet";

  const config = {
    width: canvas.width,
    height: canvas.height,
    background: canvas.background,
    actions,
    preview,
    layers: "layers.json",
  };
  const indices = isSheet ? manifest.sheet.frame.map((f) => f.index) : [0];
  if (isSheet) config.frames = indices;

  fs.writeFileSync(
    path.join(outDir, "draw.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(outDir, "layers.json"), '{\n  "layers": []\n}\n');

  // `{frame}` is the manifest's per-frame template; a single sprite uses the plain
  // paths unchanged.
  const framePath = (template, index) =>
    isSheet ? template.replaceAll("{frame}", String(index)) : template;

  return {
    isSheet,
    width: canvas.width,
    height: canvas.height,
    frames: indices.map((index) => ({
      index,
      image: framePath(preview, index),
      actions: framePath(actions, index),
    })),
    sequences: isSheet ? (manifest.sheet.sequence ?? []) : [],
  };
}

/**
 * Locate the directory holding the case's drawing binary, using the same order as
 * `resolve_binary_dir` in `crates/core/src/asset_reference.rs` so a preview and a
 * publish always draw with the same tool.
 */
function resolveBinaryDir(binary) {
  const tried = [];
  const has = (dir) => dir && fs.existsSync(path.join(dir, binary));

  if (process.env.TCAB_ASSET_BIN_DIR) {
    if (has(process.env.TCAB_ASSET_BIN_DIR))
      return process.env.TCAB_ASSET_BIN_DIR;
    tried.push(`${process.env.TCAB_ASSET_BIN_DIR} (from TCAB_ASSET_BIN_DIR)`);
  }
  const release = path.join(
    process.env.CARGO_TARGET_DIR ?? path.join(REPO_ROOT, "target"),
    "release",
  );
  if (has(release)) return release;
  tried.push(release);

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (has(dir)) return dir;
  }
  tried.push("$PATH");

  fail(
    `could not find the \`${binary}\` binary (looked in: ${tried.join(", ")}).\n` +
      `  Build it with \`cargo build --release -p test-cabinet-draw\`, or point TCAB_ASSET_BIN_DIR at its directory.`,
  );
}

/** Run a command in the seeded workspace with the drawing binary on PATH. */
function runInWorkspace(outDir, binDir, [command, ...args]) {
  try {
    execFileSync(command, args, {
      cwd: outDir,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    fail(
      `\`${command} ${args.join(" ")}\` failed${detail ? `:\n${detail}` : ""}`,
    );
  }
}

/**
 * Encode one sequence to an animated GIF, byte-for-byte the way the console's
 * download button does — see the header note. Frames are upscaled by an integer
 * factor with nearest-neighbour sampling so pixels stay square, quantized with
 * 1-bit alpha so the sprite's transparent background survives, and each frame is
 * held for `1/fps` with `dispose: 2` so transparency does not ghost.
 */
async function encodeSequenceGif(outDir, layout, frameIndices, fps) {
  const scale = Math.max(
    1,
    Math.floor(TARGET_LONGEST_SIDE / Math.max(layout.width, layout.height, 1)),
  );
  const width = layout.width * scale;
  const height = layout.height * scale;
  const delay = Math.round(1000 / Math.max(fps, 0.001));

  const byIndex = new Map(layout.frames.map((f) => [f.index, f]));
  const gif = GIFEncoder();

  for (const index of frameIndices) {
    const frame = byIndex.get(index);
    if (!frame)
      fail(`sequence names frame ${index}, which the sheet does not declare`);

    const raw = await sharp(path.join(outDir, frame.image))
      .ensureAlpha()
      .resize(width, height, { kernel: "nearest" })
      .raw()
      .toBuffer();
    const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length);

    const palette = quantize(data, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const indexed = applyPalette(data, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(indexed, width, height, {
      palette,
      delay,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      dispose: 2,
    });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

/**
 * A single page showing everything at a glance: each sequence playing, then every
 * frame with its index. Frames are shown at their real pixel data, scaled up by CSS
 * with `image-rendering: pixelated`, so the page never disagrees with the bytes on
 * disk about what was drawn.
 */
function writeContactSheet(outDir, manifest, variant, layout, gifs) {
  const scale = Math.max(
    1,
    Math.floor(TARGET_LONGEST_SIDE / Math.max(layout.width, layout.height, 1)),
  );
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  const sequences = gifs
    .map(
      ({ sequence, file }) => `
      <figure>
        <img src="${esc(file)}" alt="${esc(sequence.name ?? sequence.slug)}">
        <figcaption>${esc(sequence.name ?? sequence.slug)}
          <span>${esc(sequence.slug)} · ${sequence.frames.length} frames · ${sequence.fps} fps</span>
        </figcaption>
      </figure>`,
    )
    .join("");

  const frames = layout.frames
    .map(
      (frame) => `
      <figure>
        <img src="${esc(frame.image)}" alt="frame ${frame.index}"
             style="width:${layout.width * scale}px;height:${layout.height * scale}px">
        <figcaption>frame ${frame.index}
          <span><a href="${esc(frame.actions)}">action log</a></span>
        </figcaption>
      </figure>`,
    )
    .join("");

  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>${esc(manifest.slug)} · ${esc(variant)} · reference preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem; background: #16181c; color: #d8dde3;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: #8b94a0; margin: 2.5rem 0 1rem; font-weight: 600; }
  .meta { color: #8b94a0; margin: 0 0 .5rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 1.25rem; }
  figure { margin: 0; }
  img { image-rendering: pixelated; display: block; border: 1px solid #2c3038;
        border-radius: 4px;
        background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px; }
  figcaption { margin-top: .4rem; font-size: .8rem; }
  figcaption span { display: block; color: #8b94a0; }
  a { color: #7aa7d8; }
</style>
<h1>${esc(manifest.name ?? manifest.slug)} — <code>${esc(manifest.slug)}</code> / ${esc(variant)}</h1>
<p class="meta">${layout.width}×${layout.height} · ${layout.frames.length} frames · shown at ${scale}×</p>
${sequences ? `<h2>Sequences</h2><div class="grid">${sequences}</div>` : ""}
<h2>Frames</h2>
<div class="grid">${frames}</div>
`,
  );
}

function rel(p) {
  return path.relative(REPO_ROOT, p) || p;
}

function fail(message) {
  console.error(`preview-asset-reference: ${message}`);
  process.exit(1);
}

function usage(code) {
  console.log(
    `Render an asset-generation reference implementation to images + GIFs.

  node scripts/preview-asset-reference.mjs <slug>
  node scripts/preview-asset-reference.mjs <path/to/draw.sh>

Options:
  --variant <slug>   variant to render (default: the manifest's first)
  --version <vX.Y.Z> case version (default: newest)

Output: tmp/asset-previews/<slug>/<variant>/ — open index.html to see everything.`,
  );
  process.exit(code);
}

const { manifest, variant, outDir, layout } = main();

const gifs = [];
for (const sequence of layout.sequences) {
  const file = `${sequence.slug}.gif`;
  const bytes = await encodeSequenceGif(
    outDir,
    layout,
    sequence.frames,
    sequence.fps,
  );
  fs.writeFileSync(path.join(outDir, file), bytes);
  gifs.push({ sequence, file });
  console.log(
    `  gif:    ${file} (${sequence.frames.length} frames @ ${sequence.fps}fps)`,
  );
}

writeContactSheet(outDir, manifest, variant, layout, gifs);
console.log(`\nopen ${rel(path.join(outDir, "index.html"))}`);
