// Materialize the audio tree a run-container image bakes at `/opt/audio`.
//
// `sfx-sample`'s sample library and `music`'s instrument banks are baked into their
// images at build time, because a run container is isolated and offline. The bytes
// live in the private audio object store as already-normalized objects
// (`normalized/<clip-id>/<profile-id>.wav`), so this script downloads finished audio
// rather than deriving any, and needs neither `ffmpeg` nor a Freesound key.
//
// Given one or more pack refs it writes, under `dist/audio-image/<hash>/`:
//
//   audio/
//     clips/<clip-id>.<profile-id>.wav     one file per clip + profile, shared
//     packs/<pack-name>/pack.toml          the loader manifest
//
// Each `pack.toml` entry points at the shared clip file with
// `file = "../../clips/<clip-id>.<profile-id>.wav"`, which `load_pack` resolves
// against the pack directory, so a clip two packs use is downloaded and written once.
// `<hash>` is derived from the staged plan (every pack's identity, profile and
// entries, and every object's recorded digest), so a given set of refs stages to a
// stable path and a re-publish of any object stages to a new one.
//
// Every object is resolved through `containers/sample-packs/objects.lock.json`,
// fetched with a short-lived presigned GET, and verified against the recorded digest
// and size before it lands. A missing lock entry, a failed download, or a digest
// mismatch is a hard error: there is no path from a build to Freesound, and an
// unpublished clip fails the build instead of producing a partial palette.
//
// Only the stage this run wrote survives: every other `<hash>` directory under the
// output root is removed once the tree is complete, so the build context carries one
// staged tree rather than every palette ever staged on the machine. The download
// cache is content-addressed and is kept.
//
// stdout carries exactly one line, the absolute path of the staged root (the
// directory holding `audio/`), for `containers/build.sh` to feed to the image build.
// Progress and diagnostics go to stderr.
//
// Usage:
//   node scripts/stage-audio-image.mjs <pack-ref>...        `<name>` or `<name>@<version>`
//   node scripts/stage-audio-image.mjs <ref> --out <dir>    stage root (default: dist/audio-image)
//   node scripts/stage-audio-image.mjs <ref> --expires <s>  presigned URL lifetime (default 3600)
//   node scripts/stage-audio-image.mjs --help
//
// Downloaded objects are cached by digest under `<out>/.cache/` (override with
// `TCAB_AUDIO_OBJECT_CACHE`), so re-staging the same packs re-reads bytes it already
// verified. The cache is content-addressed and can never serve stale bytes.
//
// Reads the read-scoped PRESIGN credentials from the environment (repo-root `.env`
// locally, GitHub secrets in CI); no credential enters an image layer, because the
// signature travels in the URL and the download happens here.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyToml } from "smol-toml";

import {
  OBJECTS_LOCK_PATH,
  packPath,
  readClips,
  readObjectsLock,
  readPack,
  resolveEntry,
} from "./lib/audio-store.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { presignGetUrl, r2ConfigFromEnv } from "./lib/r2.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(repoRoot, "dist", "audio-image");

const HELP = `stage-audio-image — materialize the audio tree an image bakes

Usage:
  node scripts/stage-audio-image.mjs <pack-ref>...       \`<name>\` or \`<name>@<version>\`
  node scripts/stage-audio-image.mjs <ref> --out <dir>   stage root (default: dist/audio-image)
  node scripts/stage-audio-image.mjs <ref> --expires <s> presigned URL lifetime (default 3600)
  node scripts/stage-audio-image.mjs --help

Downloads each pack's normalized objects from the audio object store through a
presigned GET, verifies every one against containers/sample-packs/objects.lock.json,
and writes audio/clips/<clip-id>.<profile-id>.wav plus audio/packs/<name>/pack.toml
under dist/audio-image/<hash>/. Prints that staged root on stdout.`;

/** Log progress to stderr, keeping stdout to the single staged-path line. */
function log(msg) {
  process.stderr.write(`${msg}\n`);
}

/** Abort with a clear error. */
function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

/** sha256 hex of a Buffer/Uint8Array. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Parse the command line into `{ refs, out, expiresIn }`. */
function parseArgs(argv) {
  const opts = { refs: [], out: DEFAULT_OUT, expiresIn: 3600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${HELP}\n`);
      process.exit(0);
    } else if (a === "--out") {
      const value = argv[++i];
      if (value === undefined) fail("--out needs a path");
      opts.out = resolve(value);
    } else if (a === "--expires") {
      opts.expiresIn = Number(argv[++i]);
      if (
        !Number.isInteger(opts.expiresIn) ||
        opts.expiresIn <= 0 ||
        opts.expiresIn > 604800
      ) {
        fail("--expires must be an integer in 1..604800 seconds");
      }
    } else if (a.startsWith("-")) {
      fail(`unknown flag ${a} (try --help)`);
    } else {
      opts.refs.push(a);
    }
  }
  if (opts.refs.length === 0) {
    fail("name at least one pack ref, e.g. `combat-core@0.1.0` (see --help)");
  }
  return opts;
}

/**
 * Read the pack a `<name>` or `<name>@<version>` ref points at, checking a stated
 * version against the manifest. A build pins a palette by ref, so a ref that has
 * drifted from the committed manifest is an error rather than a silent substitution.
 */
function readRef(ref, clips) {
  const [name, version] = ref.split("@");
  if (!name)
    fail(`malformed pack ref "${ref}" (expected \`name\` or \`name@version\`)`);
  const pack = readPack(packPath(name), clips);
  if (version !== undefined && version !== pack.version) {
    fail(
      `pack ref ${ref} does not match its manifest: ${pack.path} is version ${pack.version}.\n` +
        "       Bump the ref that names it, or publish the version the ref asks for.",
    );
  }
  return pack;
}

/**
 * Resolve every ref into the staging plan: the packs in ref order, each with its
 * resolved entries, and the distinct objects to download. Every object's lock record
 * is required here, so a plan either describes a stage that can succeed or the script
 * has already aborted.
 */
function planStage(packs, clips, lock) {
  const objects = new Map();
  const staged = packs.map((pack) => {
    const entries = pack.entries.map((entry) => {
      const resolved = resolveEntry(pack, entry, clips);
      const record = lock[resolved.normalized_key];
      if (record === undefined) {
        fail(
          `${pack.name} "${entry.name}": ${resolved.normalized_key} is not published.\n` +
            `       ${OBJECTS_LOCK_PATH} has no record of it, so its bytes cannot be staged.\n` +
            `       Publish it with: node scripts/build-sample-pack.mjs ${pack.name} --publish`,
        );
      }
      if (
        typeof record.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(record.sha256)
      ) {
        fail(
          `${OBJECTS_LOCK_PATH}: record for ${resolved.normalized_key} has no valid "sha256"`,
        );
      }
      const file = `${resolved.clip}.${resolved.profile_id}.wav`;
      objects.set(resolved.normalized_key, {
        key: resolved.normalized_key,
        file,
        bucket: record.bucket,
        sha256: record.sha256,
        bytes: record.bytes,
      });
      return { ...resolved, file };
    });
    return { pack, entries };
  });
  return { staged, objects: [...objects.values()] };
}

/**
 * The staged plan's identity: the first 16 hex of the sha256 over its canonical JSON.
 * It covers every pack's name, version, kind and profile, every entry's presentation,
 * and every object's published digest, so identical inputs stage to the same path and
 * any change to what would be baked stages somewhere new. The digests are what make
 * a re-publish of one object stage to a new directory: the manifests can be identical
 * across it, and a stage reusing the old directory would bake the superseded bytes.
 */
function planHash(staged, objects) {
  const canonical = {
    packs: staged.map(({ pack, entries }) => ({
      name: pack.name,
      version: pack.version,
      kind: pack.kind,
      sample_rate: pack.normalize.sample_rate,
      channels: pack.normalize.channels,
      profile_id: pack.profile_id,
      entries: entries.map((e) => ({
        clip: e.clip,
        name: e.name,
        tags: e.tags,
        description: e.description,
        pitched: e.pitched,
        root_note: e.root_note ?? null,
        file: e.file,
      })),
    })),
    // Sorted by key so the hash depends on what is staged, never on ref order.
    objects: [...objects]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((o) => ({ key: o.key, sha256: o.sha256, bytes: o.bytes ?? null })),
  };
  return sha256(Buffer.from(JSON.stringify(canonical), "utf8")).slice(0, 16);
}

/**
 * Remove every stage directory under `out` except `keep` and the download cache. A
 * stage is a pure function of its plan, so an older one is dead weight in the build
 * context that `.dockerignore` re-includes for the current one. Only directories are
 * removed, and a `cacheDir` that lives under `out` is left alone.
 */
function pruneStages(out, keep, cacheDir) {
  let entries;
  try {
    entries = readdirSync(out, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === keep) continue;
    const path = join(out, entry.name);
    if (path === cacheDir) continue;
    rmSync(path, { recursive: true, force: true });
    log(`  pruned stale stage ${entry.name}`);
  }
}

/**
 * Fetch one object through a presigned GET and return its verified bytes, reading the
 * content-addressed cache first. A cache hit is verified by construction (the cache is
 * keyed by the lock's digest); a download is verified against both the recorded digest
 * and, when the lock records one, the recorded size.
 */
async function fetchObject(cfg, object, cacheDir, expiresIn) {
  const cached = join(cacheDir, object.sha256);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (sha256(bytes) === object.sha256) return { bytes, cached: true };
    rmSync(cached, { force: true });
  }

  const bucket = object.bucket ?? cfg.bucket;
  let url;
  try {
    url = presignGetUrl({ ...cfg, bucket, key: object.key, expiresIn });
  } catch (err) {
    fail(`presigning ${bucket}/${object.key}: ${err.message}`);
  }

  let res;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    fail(`downloading ${bucket}/${object.key}: ${err.message}`);
  }
  if (!res.ok) {
    fail(
      `downloading ${bucket}/${object.key}: HTTP ${res.status} ${res.statusText}.\n` +
        `       The lock records this object, so either the bucket lost it or the presign\n` +
        `       credentials do not reach ${bucket}. Re-publish the pack, or check the\n` +
        "       CLOUDFLARE_AUDIO_R2_PRESIGN pair in .env.",
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  const digest = sha256(bytes);
  if (digest !== object.sha256) {
    fail(
      `digest mismatch for ${bucket}/${object.key}:\n  lock     ${object.sha256}\n  download ${digest}\n` +
        "  The stored object was replaced out of band. Re-publish it; nothing here refetches\n" +
        "  from the original source.",
    );
  }
  if (typeof object.bytes === "number" && object.bytes !== bytes.length) {
    fail(
      `size mismatch for ${bucket}/${object.key}: lock records ${object.bytes} bytes, downloaded ${bytes.length}`,
    );
  }

  mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
  writeFileSync(cached, bytes, { mode: 0o644 });
  return { bytes, cached: false };
}

/**
 * Duration in milliseconds of a PCM-16 WAV, from its header (data-chunk bytes divided
 * by byte rate). A staged object that is not a decodable PCM-16 WAV aborts the stage,
 * because the loader decodes every file a manifest names at startup.
 */
function wavDurationMs(bytes, key) {
  const bad = (why) => fail(`${key} is not a PCM-16 WAV (${why})`);
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    bad("missing RIFF/WAVE header");
  }
  let byteRate = 0;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = bytes.toString("ascii", off, off + 4);
    const size = bytes.readUInt32LE(off + 4);
    if (id === "fmt " && off + 8 + 16 <= bytes.length) {
      const format = bytes.readUInt16LE(off + 8);
      const bits = bytes.readUInt16LE(off + 8 + 14);
      if (format !== 1) bad(`audio format ${format}, expected 1 (PCM)`);
      if (bits !== 16) bad(`${bits}-bit samples, expected 16`);
      byteRate = bytes.readUInt32LE(off + 8 + 8);
    } else if (id === "data") {
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (byteRate === 0) bad("no fmt chunk");
  if (dataLen === 0) bad("no data chunk");
  return Math.round((dataLen / byteRate) * 1000);
}

/**
 * The loader-facing manifest for one pack: a `sample_rate` plus one `[[sample]]` per
 * entry carrying the `name`, `tags`, `duration_ms`, `description` and `file` the
 * loader reads, and the `root_note` and `pitched` the `music` sequencer needs. Entries
 * keep manifest order, and `file` reaches out of the pack directory into the shared
 * clip directory.
 */
function packManifest(pack, entries, durations) {
  return {
    name: pack.name,
    version: pack.version,
    kind: pack.kind,
    sample_rate: pack.normalize.sample_rate,
    channels: pack.normalize.channels,
    sample: entries.map((entry) => ({
      name: entry.name,
      tags: entry.tags,
      duration_ms: durations.get(entry.file),
      description: entry.description,
      file: `../../clips/${entry.file}`,
      root_note: entry.root_note ?? 60,
      pitched: entry.pitched,
    })),
  };
}

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));

  const clips = readClips();
  const lock = readObjectsLock();
  const packs = opts.refs.map((ref) => readRef(ref, clips));
  const { staged, objects } = planStage(packs, clips, lock);

  const hash = planHash(staged, objects);
  const stageRoot = join(opts.out, hash);
  const audioDir = join(stageRoot, "audio");
  const clipsDir = join(audioDir, "clips");
  const packsDir = join(audioDir, "packs");
  const cacheDir = process.env.TCAB_AUDIO_OBJECT_CACHE
    ? resolve(process.env.TCAB_AUDIO_OBJECT_CACHE)
    : join(opts.out, ".cache");

  log(
    `staging ${packs.length} pack${packs.length === 1 ? "" : "s"} (${packs
      .map((p) => `${p.name}@${p.version}`)
      .join(
        ", ",
      )}) — ${objects.length} distinct clip object${objects.length === 1 ? "" : "s"}`,
  );

  // Resolve the credentials before touching the filesystem, so a missing presign pair
  // fails without having disturbed an earlier stage of the same plan.
  const cfg = r2ConfigFromEnv("presign");

  // Clean before writing: a stale file from an earlier stage of the same hash would
  // otherwise ride into the image, and the tree must be a pure function of the plan.
  // Modes are pinned for the same reason, so the local umask cannot reach the image.
  rmSync(audioDir, { recursive: true, force: true });
  mkdirSync(clipsDir, { recursive: true, mode: 0o755 });

  const durations = new Map();
  for (const object of objects) {
    const { bytes, cached } = await fetchObject(
      cfg,
      object,
      cacheDir,
      opts.expiresIn,
    );
    durations.set(object.file, wavDurationMs(bytes, object.key));
    writeFileSync(join(clipsDir, object.file), bytes, { mode: 0o644 });
    log(
      `  ${cached ? "cached  " : "verified"} ${object.file} (${bytes.length} bytes, ${durations.get(object.file)}ms)`,
    );
  }

  for (const { pack, entries } of staged) {
    const dir = join(packsDir, pack.name);
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    const manifest = packManifest(pack, entries, durations);
    writeFileSync(join(dir, "pack.toml"), `${stringifyToml(manifest)}\n`, {
      mode: 0o644,
    });
    log(`  wrote packs/${pack.name}/pack.toml (${entries.length} entries)`);
  }

  // Only now, with the tree complete: a prune before it would drop the directory a
  // failed stage could still have been retried into.
  pruneStages(opts.out, hash, cacheDir);

  log(`staged ${stageRoot}`);
  process.stdout.write(`${stageRoot}\n`);
}

// An unexpected throw reports its message; set `TCAB_AUDIO_DEBUG=1` for the stack.
main().catch((err) =>
  fail(
    process.env.TCAB_AUDIO_DEBUG
      ? (err?.stack ?? String(err))
      : (err?.message ?? String(err)),
  ),
);
