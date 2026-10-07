// Materialize the HOST AUDIO STORE: every published audio pack, as files on disk.
//
// The store is what a run's declared packs are staged out of. `crates/core`'s
// `audio_stage` reads it at `TCAB_AUDIO_STORE` (default `/opt/tcab-audio`) and copies
// the packs a case names in `[audio] packs` — and only those — into the container that
// is about to run it. No image bakes a pack, so this tree is the single place the
// published bytes land, and it travels as the data-only `audio-store` image
// (`containers/audio-store/Dockerfile`), which the driver image copies in and
// `scripts/fetch-audio-store.sh` pulls onto a local checkout.
//
// The bytes live in the private audio object store as already-normalized objects
// (`normalized/<clip-id>/<profile-id>.wav`), so this script downloads finished audio
// rather than deriving any, and needs neither `ffmpeg` nor a Freesound key.
//
// It writes, under `dist/audio-store/` (override with `--out`):
//
//   tree/
//     objects.lock.json                       the published-object record, copied whole
//     clips/<clip-id>.<profile-id>.wav        one file per clip + profile, shared
//     packs/<name>@<version>/pack.toml        the loader manifest
//
// Each `pack.toml` entry points at the shared clip file with
// `file = "../../clips/<clip-id>.<profile-id>.wav"`, which `load_pack` resolves against
// the pack directory, so a clip two packs use is downloaded and written once. A pack
// directory is keyed by `<name>@<version>` so two versions of one pack sit in the store
// together, which is what lets a case pin a version rather than a name. The staged tree
// and the tree inside a run container have the SAME layout, so staging a run copies each
// manifest byte for byte and its relative `file` resolves unchanged.
//
// The lock is copied in beside the audio because staging verifies every clip it carries
// into a container against it: a store is then verifiable wherever it was fetched from,
// not only on a machine holding this repository.
//
// Every object is resolved through `containers/sample-packs/objects.lock.json`, fetched
// with a short-lived presigned GET, and verified against the recorded digest and size
// before it lands. A missing lock entry, a failed download, or a digest mismatch is a
// hard error: there is no path from a build to Freesound, and an unpublished clip fails
// the build instead of producing a partial store.
//
// The tree is content-addressed and additive — a clip file's name is its identity, and a
// pack directory's name is its version — so re-staging is idempotent and nothing here
// prunes. Publishing a new pack version adds a directory; it never rewrites one a case
// already pins.
//
// Usage:
//   node scripts/stage-audio-store.mjs                    every published pack
//   node scripts/stage-audio-store.mjs <pack-ref>...      `<name>` or `<name>@<version>`
//   node scripts/stage-audio-store.mjs --out <dir>        output root (default: dist/audio-store)
//   node scripts/stage-audio-store.mjs --expires <s>      presigned URL lifetime (default 3600)
//   node scripts/stage-audio-store.mjs --help
//
// Downloaded objects are cached by digest under `<out>/.cache/` (override with
// `TCAB_AUDIO_OBJECT_CACHE`), so re-staging re-reads bytes it already verified. The cache
// is content-addressed and can never serve stale bytes. It sits BESIDE the tree rather
// than inside it, because the tree is what an image build copies.
//
// Reads the read-scoped PRESIGN credentials from the environment (repo-root `.env`
// locally, GitHub secrets in CI); no credential enters an image layer, because the
// signature travels in the URL and the download happens here.

import { createHash } from "node:crypto";
import {
  copyFileSync,
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
  PACKS_DIR,
  packManifest,
  packPath,
  readClips,
  readObjectsLock,
  readPack,
  resolveEntry,
  wavDurationMs,
} from "./lib/audio-store.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { presignGetUrl, r2ConfigFromEnv } from "./lib/r2.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(repoRoot, "dist", "audio-store");

const HELP = `stage-audio-store — materialize the host audio store

Usage:
  node scripts/stage-audio-store.mjs                   every published pack
  node scripts/stage-audio-store.mjs <pack-ref>...     \`<name>\` or \`<name>@<version>\`
  node scripts/stage-audio-store.mjs --out <dir>       output root (default: dist/audio-store)
  node scripts/stage-audio-store.mjs --expires <s>     presigned URL lifetime (default 3600)
  node scripts/stage-audio-store.mjs --help

Downloads each pack's normalized objects from the audio object store through a
presigned GET, verifies every one against containers/sample-packs/objects.lock.json,
and writes <out>/tree/clips/<clip-id>.<profile-id>.wav,
<out>/tree/packs/<name>@<version>/pack.toml and a copy of the object lock.`;

/** Log progress to stderr, keeping stdout free. */
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
  return opts;
}

/**
 * Every pack manifest committed under `containers/sample-packs/`, which is what a run
 * with no named refs stages: the store is the whole published set, so a case can pin any
 * pack in the registry and staging can answer it. `clips.toml` is the registry, not a
 * pack.
 */
function allPackFiles() {
  return readdirSync(PACKS_DIR)
    .sort()
    .filter((file) => file.endsWith(".toml") && file !== "clips.toml");
}

/**
 * Read the pack a `<name>` or `<name>@<version>` ref points at, checking a stated
 * version against the manifest. A ref pins a palette, so one that has drifted from the
 * committed manifest is an error rather than a silent substitution.
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
 * Resolve every pack into the staging plan: the packs in order, each with its resolved
 * entries, and the distinct objects to download. Every object's lock record is required
 * here, so a plan either describes a stage that can succeed or the script has already
 * aborted.
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

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));

  const clips = readClips();
  const lock = readObjectsLock();
  const packs =
    opts.refs.length > 0
      ? opts.refs.map((ref) => readRef(ref, clips))
      : allPackFiles().map((file) => readPack(join(PACKS_DIR, file), clips));
  if (packs.length === 0) {
    fail(`no pack manifests in ${PACKS_DIR}, so there is no store to stage`);
  }
  const { staged, objects } = planStage(packs, clips, lock);

  const treeDir = join(opts.out, "tree");
  const clipsDir = join(treeDir, "clips");
  const packsDir = join(treeDir, "packs");
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
  // fails without having disturbed a store an earlier run staged.
  const cfg = r2ConfigFromEnv("presign");

  // Modes are pinned so the local umask cannot reach the image: the audio-store image
  // copies this tree with `--chmod`, but the driver's local store is read straight off
  // disk by whatever fetched it.
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
    // Keyed by `<name>@<version>`, which is the ref a case pins: two versions of one
    // pack coexist, and staging a run resolves a ref by joining it onto `packs/`.
    const dir = join(packsDir, `${pack.name}@${pack.version}`);
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    const manifest = packManifest(pack, entries, durations);
    writeFileSync(join(dir, "pack.toml"), `${stringifyToml(manifest)}\n`, {
      mode: 0o644,
    });
    log(
      `  wrote packs/${pack.name}@${pack.version}/pack.toml (${entries.length} entries)`,
    );
  }

  // The lock travels with the bytes: staging a run verifies every clip it copies into a
  // container against it, and the machine doing that has the store but not this
  // repository.
  copyFileSync(OBJECTS_LOCK_PATH, join(treeDir, "objects.lock.json"));
  log(`  wrote objects.lock.json`);

  log(`staged ${treeDir}`);
}

// An unexpected throw reports its message; set `TCAB_AUDIO_DEBUG=1` for the stack.
main().catch((err) =>
  fail(
    process.env.TCAB_AUDIO_DEBUG
      ? (err?.stack ?? String(err))
      : (err?.message ?? String(err)),
  ),
);
