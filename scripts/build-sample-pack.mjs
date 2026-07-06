// Assemble a baked audio sample pack / instrument bank from a committed manifest.
//
// `sfx-sample`'s **sample library** and `music`'s **instrument bank** are the fixed
// audio palettes those tools ship with, baked into their run-container image at build
// time (a run container is offline, so nothing is fetched at run time). The audio
// files themselves are NOT committed to this repository — see
// `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`
// ("The sample library") and `containers/README.md`
// ("The sample library and instrument bank"). What the repo commits is a small
// per-pack manifest, `containers/sample-packs/<pack>.toml`, listing for each entry a
// stable `name`, `tags`, `description`, permissive `license`, a source `url`, and a
// `sha256` content hash.
//
// This script turns one of those manifests into a **content-addressed pack**: it
//   1. parses and validates the manifest,
//   2. fetches each named source URL,
//   3. VERIFIES the fetched bytes against the declared `sha256` (a mismatch aborts),
//   4. NORMALIZES each source (sample rate / channels / loudness / trim / format) to a
//      PCM-16 `.wav` the `audio-core` loader can `decode_pcm16` — shelling out to
//      `ffmpeg` (with a clear note, and a documented raw-copy skeleton, when it is
//      unavailable),
//   5. writes a loader-facing baked manifest (`pack.toml`) alongside the normalized
//      `<name>.wav` files — the exact on-disk layout `crates/audio-core/src/sample.rs`
//      reads (a `*.toml` with `sample_rate` + `[[sample]]` entries, and `<file>` audio
//      beside it), and
//   6. assembles a deterministic tarball and prints its **sha256 digest** — the value
//      the `sfx-sample` / `music` image build pins the pack by (see the TODO blocks in
//      `containers/sfx-sample/Dockerfile` and `containers/music/Dockerfile`).
//
// The normalize + pack step is a runnable skeleton where a full audio pipeline is out
// of reach (no `ffmpeg`): it still produces a correct layout and a stable digest, and
// says loudly what it stubbed. The manifest parse and the sha256 verify are real.
//
// Usage:
//   node scripts/build-sample-pack.mjs <pack>              # containers/sample-packs/<pack>.toml
//   node scripts/build-sample-pack.mjs --manifest <path>   # an explicit manifest path
//   node scripts/build-sample-pack.mjs <pack> --check      # parse + validate only (no fetch)
//   node scripts/build-sample-pack.mjs <pack> --out <dir>  # output root (default: dist/sample-packs)
//   node scripts/build-sample-pack.mjs --help
//
// `--check` performs the manifest parse + validation without touching the network, so
// it is the cheap way to confirm a manifest (including the committed EXAMPLE ones)
// parses. A real build (no `--check`) fetches every source and will fail on the
// EXAMPLE manifests' placeholder URLs by design — replace those first.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_DIR = join(repoRoot, "containers", "sample-packs");
const DEFAULT_OUT = join(repoRoot, "dist", "sample-packs");

// A source's license must be CC0 or otherwise permissive so a produced clip is freely
// usable in a test case and a published run. We accept a known-permissive set outright
// and hard-reject the tell-tale NonCommercial / NoDerivatives CC restrictions; anything
// else is allowed with a warning so an unusual-but-permissive SPDX id is not blocked.
const PERMISSIVE_LICENSES = new Set([
  "CC0",
  "CC0-1.0",
  "PUBLIC DOMAIN",
  "UNLICENSE",
  "MIT",
  "APACHE-2.0",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "CC-BY-3.0",
  "CC-BY-4.0",
]);

/** Log a normal progress line. */
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/** Log a warning to stderr (does not abort). */
function warn(msg) {
  process.stderr.write(`WARN: ${msg}\n`);
}

/** Abort with a clear one-line error. */
function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

const HELP = `build-sample-pack — assemble a baked audio sample pack / instrument bank

Usage:
  node scripts/build-sample-pack.mjs <pack>              containers/sample-packs/<pack>.toml
  node scripts/build-sample-pack.mjs --manifest <path>   an explicit manifest path
  node scripts/build-sample-pack.mjs <pack> --check      parse + validate only (no fetch)
  node scripts/build-sample-pack.mjs <pack> --out <dir>  output root (default: dist/sample-packs)
  node scripts/build-sample-pack.mjs --help

Reads a committed pack manifest (name/tags/description/license/url/sha256 per entry),
fetches and sha256-verifies each source, normalizes it to a PCM-16 .wav via ffmpeg,
writes the loader-facing layout audio-core expects, tars it deterministically, and
prints the resulting sha256 digest — the value the sfx-sample / music Dockerfile pins.`;

/** Minimal flag parser (no positional/flag interleaving surprises). */
function parseArgs(argv) {
  const opts = { pack: null, manifest: null, out: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      log(HELP);
      process.exit(0);
    } else if (a === "--check") {
      opts.check = true;
    } else if (a === "--manifest") {
      opts.manifest = argv[++i] ?? fail("--manifest needs a path");
    } else if (a === "--out") {
      opts.out = resolve(argv[++i] ?? fail("--out needs a path"));
    } else if (a.startsWith("-")) {
      fail(`unknown flag ${a} (try --help)`);
    } else if (opts.pack === null) {
      opts.pack = a;
    } else {
      fail(`unexpected extra argument ${a} (try --help)`);
    }
  }
  return opts;
}

/** Resolve the manifest path from either `--manifest <path>` or a bare `<pack>` name. */
function resolveManifestPath(opts) {
  if (opts.manifest) return resolve(opts.manifest);
  if (!opts.pack) {
    fail("name a pack (e.g. `sfx-core`) or pass --manifest <path> (see --help)");
  }
  // Accept either the bare stem or a `<pack>.toml` for convenience.
  const stem = opts.pack.endsWith(".toml") ? opts.pack.slice(0, -5) : opts.pack;
  return join(PACKS_DIR, `${stem}.toml`);
}

/**
 * Parse + validate a committed manifest. Returns
 * `{ name, version, kind, normalize, entries }` with entries carrying the source
 * `url`/`sha256`/`license` and browse metadata. Aborts on any structural problem.
 */
function loadManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    fail(`reading manifest ${path}: ${err.message}`);
  }
  let doc;
  try {
    doc = parseToml(raw);
  } catch (err) {
    fail(`parsing manifest ${path}: ${err.message}`);
  }

  const name = requireStr(doc, "name", path);
  const version = requireStr(doc, "version", path);
  // `sample-pack` (sfx-sample) or `instrument-bank` (music); free-form but recorded.
  const kind = typeof doc.kind === "string" ? doc.kind : "sample-pack";

  const norm = doc.normalize ?? {};
  const normalize = {
    sample_rate: intOr(norm.sample_rate, 44100),
    channels: intOr(norm.channels, 1),
    loudness_lufs: numOr(norm.loudness_lufs, -23),
    true_peak_dbfs: numOr(norm.true_peak_dbfs, -1),
    trim_silence: norm.trim_silence !== false,
    max_duration_ms: intOr(norm.max_duration_ms, 5000),
  };
  if (normalize.channels !== 1 && normalize.channels !== 2) {
    fail(`${path}: normalize.channels must be 1 or 2, got ${normalize.channels}`);
  }
  if (normalize.max_duration_ms > 5000) {
    // The clip cap is 5000ms; a source may be longer but the baked sample should not
    // silently exceed what a run can place.
    warn(
      `${path}: normalize.max_duration_ms ${normalize.max_duration_ms} exceeds the 5000ms clip ceiling`,
    );
  }

  // Entries live under [[sample]] and/or [[instrument]] — the loader aliases both, so
  // an instrument bank may use whichever table reads best. Merge in declaration order.
  const rawEntries = [
    ...(Array.isArray(doc.sample) ? doc.sample : []),
    ...(Array.isArray(doc.instrument) ? doc.instrument : []),
  ];
  if (rawEntries.length === 0) {
    fail(`${path}: no [[sample]] / [[instrument]] entries`);
  }

  const seen = new Set();
  const entries = rawEntries.map((e, i) => {
    const where = `${path} entry #${i + 1}`;
    const entryName = requireStr(e, "name", where);
    if (seen.has(entryName)) fail(`${where}: duplicate name "${entryName}"`);
    seen.add(entryName);
    const url = requireStr(e, "url", `${where} (${entryName})`);
    const sha256 = requireStr(e, "sha256", `${where} (${entryName})`).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      fail(`${where} (${entryName}): sha256 must be 64 hex chars, got "${sha256}"`);
    }
    const license = requireStr(e, "license", `${where} (${entryName})`);
    checkLicense(license, entryName);
    return {
      name: entryName,
      tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
      description: typeof e.description === "string" ? e.description : "",
      license,
      url,
      sha256,
    };
  });

  return { name, version, kind, normalize, entries };
}

function requireStr(obj, key, where) {
  const v = obj?.[key];
  if (typeof v !== "string" || v.length === 0) {
    fail(`${where}: missing required string field "${key}"`);
  }
  return v;
}

function intOr(v, dflt) {
  return Number.isFinite(v) ? Math.trunc(v) : dflt;
}

function numOr(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

/** Reject NC/ND licenses; warn on anything not in the known-permissive set. */
function checkLicense(license, entryName) {
  const up = license.toUpperCase();
  if (up.includes("-NC") || up.includes("-ND") || up.includes("NONCOMMERCIAL") || up.includes("NODERIV")) {
    fail(`sample "${entryName}": non-permissive license "${license}" (NC/ND clips cannot ship)`);
  }
  if (!PERMISSIVE_LICENSES.has(up)) {
    warn(`sample "${entryName}": license "${license}" is not in the known-permissive set — confirm it is CC0/permissive`);
  }
}

/** True if `ffmpeg` is invocable. */
function haveFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** sha256 hex of a Buffer/Uint8Array. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A source hosted on Freesound. Its per-sample `url` is a preview transcode on the
 * Freesound CDN (`cdn.freesound.org/previews/…`) — the token-tier download that needs
 * only a free API key, never the OAuth2 flow the original files require. The preview
 * CDN currently serves those files without auth once the URL is known, but a curator
 * finds and verifies them through the authenticated API, so we send the token when one
 * is set: harmless if the CDN ignores it, and future-proof if it ever starts gating.
 * See `containers/sample-packs/README.md` ("Freesound sources").
 */
function isFreesound(url) {
  try {
    return /(^|\.)freesound\.org$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Fetch a URL to a Buffer, following redirects; aborts on a non-OK response. A
 * Freesound URL carries the `FREESOUND_API_KEY` token when one is in the environment
 * (see {@link isFreesound}). */
async function fetchBytes(url) {
  const headers = {};
  if (isFreesound(url) && process.env.FREESOUND_API_KEY) {
    headers.Authorization = `Token ${process.env.FREESOUND_API_KEY}`;
  }
  let res;
  try {
    res = await fetch(url, { redirect: "follow", headers });
  } catch (err) {
    fail(`fetching ${url}: ${err.message}`);
  }
  if (!res.ok) fail(`fetching ${url}: HTTP ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Normalize one verified source buffer to a PCM-16 mono/stereo `.wav` at the pack's
 * target rate. With ffmpeg: resample, downmix, trim leading/trailing silence, loudness-
 * and true-peak-normalize, cap the duration, and encode `pcm_s16le`. Without ffmpeg:
 * a documented skeleton — copy the verified bytes through so the layout + digest are
 * still produced, and warn that the audio is NOT normalized (and may not be PCM-16).
 * Returns the output `.wav` bytes.
 */
function normalize(normalizeSpec, entry, ffmpeg, tmp, srcBytes) {
  const entryName = entry.name;
  if (!ffmpeg) {
    warn(`ffmpeg not found — writing "${entryName}" UNNORMALIZED (skeleton copy; install ffmpeg for a real pack)`);
    return srcBytes;
  }
  const inPath = join(tmp, `${entryName}.src`);
  const outPath = join(tmp, `${entryName}.norm.wav`);
  writeFileSync(inPath, srcBytes);

  const filters = [];
  if (normalizeSpec.trim_silence) {
    // Trim leading and trailing near-silence (reverse trick trims the tail).
    filters.push(
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02",
      "areverse",
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02",
      "areverse",
    );
  }
  filters.push(
    `loudnorm=I=${normalizeSpec.loudness_lufs}:TP=${normalizeSpec.true_peak_dbfs}:LRA=11`,
  );

  const args = [
    "-nostdin",
    "-y",
    "-i",
    inPath,
    "-af",
    filters.join(","),
    "-ar",
    String(normalizeSpec.sample_rate),
    "-ac",
    String(normalizeSpec.channels),
    "-t",
    (normalizeSpec.max_duration_ms / 1000).toFixed(3),
    "-c:a",
    "pcm_s16le",
    outPath,
  ];
  try {
    execFileSync("ffmpeg", args, { stdio: "ignore" });
  } catch (err) {
    fail(`normalizing "${entryName}" with ffmpeg: ${err.message}`);
  }
  return readFileSync(outPath);
}

/**
 * Duration in ms of a PCM-16 WAV, read from its header (data-chunk bytes / byte-rate).
 * Returns 0 for a non-WAV skeleton copy — the loader defaults `duration_ms` to 0.
 */
function wavDurationMs(bytes) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return 0;
  }
  // Walk chunks to find `fmt ` (byte rate) and `data` (size).
  let byteRate = 0;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = bytes.toString("ascii", off, off + 4);
    const size = bytes.readUInt32LE(off + 4);
    if (id === "fmt " && off + 8 + 16 <= bytes.length) {
      byteRate = bytes.readUInt32LE(off + 8 + 8);
    } else if (id === "data") {
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (byteRate === 0) return 0;
  return Math.round((dataLen / byteRate) * 1000);
}

/**
 * Tar a directory deterministically (sorted, zeroed owner/mtime) and return the
 * tarball's sha256. GNU tar's reproducibility flags make the digest a pure function of
 * the pack's content, so it is a stable content address. Shells out to `tar`.
 */
function tarDigest(dir, outTar) {
  try {
    execFileSync(
      "tar",
      [
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--format=gnu",
        "-cf",
        outTar,
        "-C",
        dir,
        ".",
      ],
      { stdio: "ignore" },
    );
  } catch (err) {
    fail(`assembling tarball with tar: ${err.message} (GNU tar with --sort/--mtime is required for a deterministic digest)`);
  }
  return sha256(readFileSync(outTar));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPath = resolveManifestPath(opts);
  log(`manifest: ${manifestPath}`);

  const manifest = loadManifest(manifestPath);
  log(`pack: ${manifest.name}@${manifest.version} (${manifest.kind}) — ${manifest.entries.length} entr${manifest.entries.length === 1 ? "y" : "ies"}`);
  log(
    `normalize: ${manifest.normalize.sample_rate}Hz / ${manifest.normalize.channels}ch / ` +
      `${manifest.normalize.loudness_lufs} LUFS / TP ${manifest.normalize.true_peak_dbfs} dBFS / ` +
      `${manifest.normalize.trim_silence ? "trim" : "no-trim"} / cap ${manifest.normalize.max_duration_ms}ms`,
  );
  for (const e of manifest.entries) {
    log(`  - ${e.name}  [${e.tags.join(", ")}]  <${e.license}>`);
  }

  if (opts.check) {
    log("");
    log("check OK — manifest parses and validates. (No fetch performed; run without --check to build.)");
    return;
  }

  const ffmpeg = haveFfmpeg();
  if (!ffmpeg) {
    warn("ffmpeg not on PATH: normalization is stubbed to a raw copy. Install ffmpeg to produce a real, PCM-16-normalized pack.");
  }

  const outRoot = opts.out;
  const packDirName = `${manifest.name}-${manifest.version}`;
  const stageDir = join(outRoot, packDirName);
  mkdirSync(stageDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "sample-pack-"));

  const bakedEntries = [];
  try {
    for (const e of manifest.entries) {
      log(`fetch ${e.name}: ${e.url}`);
      const src = await fetchBytes(e.url);
      const got = sha256(src);
      if (got !== e.sha256) {
        fail(`sha256 mismatch for "${e.name}":\n  declared ${e.sha256}\n  fetched  ${got}`);
      }
      log(`  sha256 verified (${src.length} bytes)`);

      const wav = normalize(manifest.normalize, e, ffmpeg, tmp, src);
      const file = `${e.name}.wav`;
      writeFileSync(join(stageDir, file), wav);
      bakedEntries.push({
        name: e.name,
        tags: e.tags,
        duration_ms: wavDurationMs(wav),
        description: e.description,
        file,
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // The loader-facing baked manifest: exactly what `audio-core`'s `load_pack` reads —
  // a `*.toml` with `sample_rate` and `[[sample]]` entries beside the audio files.
  const baked = {
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    sample_rate: manifest.normalize.sample_rate,
    channels: manifest.normalize.channels,
    sample: bakedEntries,
  };
  writeFileSync(join(stageDir, "pack.toml"), `${stringifyToml(baked)}\n`);
  log(`wrote baked layout: ${stageDir}/ (pack.toml + ${bakedEntries.length} .wav)`);

  const outTar = join(outRoot, `${packDirName}.tar`);
  const digest = tarDigest(stageDir, outTar);
  log(`wrote tarball: ${outTar}`);
  log("");
  log(`pack digest: sha256:${digest}`);
  log("");
  log("Pin this in the image build (see containers/sfx-sample/Dockerfile / containers/music/Dockerfile):");
  log(`  --build-arg SAMPLE_PACK=${manifest.name}@${manifest.version} \\`);
  log(`  --build-arg SAMPLE_PACK_SHA256=${digest} \\`);
  log(`  --build-arg SAMPLE_PACK_URL=<object-storage URL of ${packDirName}.tar>`);
}

main().catch((err) => fail(err?.stack ?? String(err)));
