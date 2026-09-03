// Publish the normalized audio objects one pack needs into the audio object store.
//
// A pack (`containers/sample-packs/<pack>.toml`) is a collection of CLIP IDS plus the
// presentation and the `[normalize]` profile that pack applies. The clip bytes live in
// the private audio bucket, never in this repository, and in two shapes:
//
//   sources/<clip-id>                      the original bytes, uploaded once at ingest
//   normalized/<clip-id>/<profile-id>.wav  that clip rendered under one profile
//
// This script owns the second shape. For each entry of each named pack it resolves the
// clip through `containers/sample-packs/clips.toml`, derives the pack's `profile-id`,
// and asks whether `normalized/<clip-id>/<profile-id>.wav` is already recorded in
// `containers/sample-packs/objects.lock.json`. For anything missing it downloads
// `sources/<clip-id>` from the store, verifies the bytes hash to the clip id,
// normalizes them to a PCM-16 WAV with `ffmpeg`, and — with `--publish` — uploads the
// result and records its key, digest and size in the lock.
//
// Publishing the normalized bytes once is what makes an image build reproducible:
// every later consumer downloads a finished `.wav` instead of re-deriving it, so the
// baked audio no longer depends on the local `ffmpeg` build's loudness normalization.
// The work is per clip and per profile, so editing one entry of a pack publishes one
// object and leaves the rest of the pack alone.
//
// INGEST IS A DIFFERENT STEP. Freesound is contacted only when a clip is first
// ingested, by a developer, once per clip (`scripts/curate-instrument-bank.mjs --ingest`;
// see `containers/sample-packs/README.md`). This script reads clip bytes only from The
// Test Cabinet's own store, and a pack naming a clip whose source object is not in the
// lock is an error telling the developer to ingest it.
//
// Usage:
//   node scripts/build-sample-pack.mjs <pack>...            publish what those packs need
//   node scripts/build-sample-pack.mjs --all                every pack in the directory
//   node scripts/build-sample-pack.mjs <pack> --check        parse + validate, no network
//   node scripts/build-sample-pack.mjs <pack> --publish      upload + record the lock
//   node scripts/build-sample-pack.mjs <pack> --verify       also HEAD each locked object
//   node scripts/build-sample-pack.mjs <pack> --force        re-normalize locked objects
//   node scripts/build-sample-pack.mjs --help
//
// `--check` parses the registry, the pack manifests and the lock, validates every
// clip reference and license, and reports which objects a publish would produce. It
// touches neither the network nor `ffmpeg`, so it is the cheap way to confirm a
// manifest edit. Without `--check` and without `--publish` the script does the real
// work but stops short of uploading, which rehearses a publish with the read-only
// presign credentials.
//
// Credentials come from the environment (repo-root `.env` locally). `--publish` needs
// the write-scoped PUBLISH pair; a rehearsal needs only the read-scoped PRESIGN pair.
// Publishing is a deliberate, local curation step, and CI never writes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  CLIPS_PATH,
  OBJECTS_LOCK_PATH,
  PACKS_DIR,
  packPath,
  readClips,
  readObjectsLock,
  readPack,
  resolveEntry,
  writeObjectsLock,
} from "./lib/audio-store.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import {
  getObject,
  headObject,
  putObject,
  r2ConfigFromEnv,
} from "./lib/r2.mjs";

// A clip's license must be CC0 or otherwise permissive so a produced clip is freely
// usable in a test case and a published run. A known-permissive set is accepted
// outright and the tell-tale NonCommercial / NoDerivatives CC restrictions are
// rejected; anything else is allowed with a warning so an unusual-but-permissive SPDX
// id is not blocked.
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

const HELP = `build-sample-pack — publish the normalized audio one pack needs

Usage:
  node scripts/build-sample-pack.mjs <pack>...        publish what those packs need
  node scripts/build-sample-pack.mjs --all            every pack in containers/sample-packs
  node scripts/build-sample-pack.mjs <pack> --check   parse + validate only (no network)
  node scripts/build-sample-pack.mjs <pack> --publish upload + record objects.lock.json
  node scripts/build-sample-pack.mjs <pack> --verify  HEAD each already-locked object
  node scripts/build-sample-pack.mjs <pack> --force   re-normalize objects already locked
  node scripts/build-sample-pack.mjs --manifest <path>  an explicit manifest path
  node scripts/build-sample-pack.mjs --help

Resolves each entry's clip through clips.toml, derives the pack's normalize profile
id, downloads sources/<clip-id> from the audio object store, normalizes it to PCM-16
WAV with ffmpeg, and with --publish uploads normalized/<clip-id>/<profile-id>.wav and
records it in objects.lock.json. Clip bytes are read only from the store; ingest is
the only step that contacts Freesound.`;

/** Log progress. */
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/** Log a warning (does not abort). */
function warn(msg) {
  process.stderr.write(`WARN: ${msg}\n`);
}

/** Abort with a clear one-line error. */
function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

/** sha256 hex of a Buffer/Uint8Array. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Parse the command line into `{ packs, manifests, all, check, publish, verify, force }`. */
function parseArgs(argv) {
  const opts = {
    packs: [],
    manifests: [],
    all: false,
    check: false,
    publish: false,
    verify: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      log(HELP);
      process.exit(0);
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--check") {
      opts.check = true;
    } else if (a === "--publish") {
      opts.publish = true;
    } else if (a === "--verify") {
      opts.verify = true;
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--manifest") {
      const value = argv[++i];
      if (value === undefined) fail("--manifest needs a path");
      opts.manifests.push(resolve(value));
    } else if (a.startsWith("-")) {
      fail(`unknown flag ${a} (try --help)`);
    } else {
      opts.packs.push(a);
    }
  }
  if (opts.check && opts.publish) {
    fail("--check and --publish are mutually exclusive");
  }
  return opts;
}

/** Every pack manifest committed under `containers/sample-packs/`. */
function allPackPaths() {
  return readdirSync(PACKS_DIR)
    .filter((f) => f.endsWith(".toml") && f !== basename(CLIPS_PATH))
    .sort()
    .map((f) => join(PACKS_DIR, f));
}

/** The manifest paths this invocation works on, from `<pack>`, `--manifest` and `--all`. */
function resolveManifestPaths(opts) {
  const paths = [...opts.manifests, ...opts.packs.map((p) => packPath(p))];
  if (opts.all) paths.push(...allPackPaths());
  if (paths.length === 0) {
    fail("name a pack (e.g. `gm-lite`), or pass --all (see --help)");
  }
  return [...new Set(paths)];
}

/** Reject NC/ND licenses; warn on anything not in the known-permissive set. */
function checkLicense(license, clipId, where) {
  const up = license.toUpperCase();
  if (
    up.includes("-NC") ||
    up.includes("-ND") ||
    up.includes("NONCOMMERCIAL") ||
    up.includes("NODERIV")
  ) {
    fail(
      `clip ${clipId} (${where}): non-permissive license "${license}" — NC/ND clips cannot ship`,
    );
  }
  if (!PERMISSIVE_LICENSES.has(up)) {
    warn(
      `clip ${clipId} (${where}): license "${license}" is not in the known-permissive set — confirm it is CC0 or otherwise permissive`,
    );
  }
}

/**
 * Build the work plan for the named packs: one job per distinct
 * `normalized/<clip-id>/<profile-id>.wav` key, carrying the clip, the profile and the
 * pack entries that want it, plus the source objects the lock does not record. Every
 * clip reference and license is validated here, so a returned plan either describes
 * work that can succeed or names exactly what is missing.
 */
function planPacks(packs, clips, lock) {
  const jobs = new Map();
  const unpublishedSources = new Map();
  for (const pack of packs) {
    for (const entry of pack.entries) {
      const resolved = resolveEntry(pack, entry, clips);
      const where = `${pack.name} "${entry.name}"`;
      checkLicense(resolved.license, resolved.clip, where);

      if (lock[resolved.source_key] === undefined) {
        unpublishedSources.set(resolved.source_key, where);
      }

      const job = jobs.get(resolved.normalized_key) ?? {
        key: resolved.normalized_key,
        clip: resolved.clip,
        source_key: resolved.source_key,
        profile_id: pack.profile_id,
        normalize: pack.normalize,
        wanted_by: [],
      };
      job.wanted_by.push(where);
      jobs.set(job.key, job);
    }
  }
  return { jobs: [...jobs.values()], unpublishedSources };
}

/**
 * Abort when any clip a job needs has no `sources/<clip-id>` in the lock. The bytes to
 * normalize come from the store and from nowhere else, so an unpublished source is a
 * developer instruction to ingest the clip rather than something to fetch.
 */
function requirePublishedSources(jobs, unpublishedSources) {
  const blocking = jobs.filter((job) => unpublishedSources.has(job.source_key));
  if (blocking.length === 0) return;
  const lines = blocking.map(
    (job) => `         ${job.source_key}  (${job.wanted_by.join(", ")})`,
  );
  fail(
    `${blocking.length} clip${blocking.length === 1 ? " has" : "s have"} no source object in ${OBJECTS_LOCK_PATH}:\n` +
      `${lines.join("\n")}\n` +
      "       Their source bytes are not in the object store. Seed every registered clip with\n" +
      "       node scripts/curate-instrument-bank.mjs --seed-sources --publish, commit\n" +
      `       the updated ${basename(OBJECTS_LOCK_PATH)}, then re-run this publish.`,
  );
}

/** Abort unless `ffmpeg` is invocable: normalization has no fallback. */
function requireFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    fail(
      "ffmpeg is not on PATH. Normalized bytes are the published artifact, so a publish\n" +
        "       cannot substitute an unnormalized copy. Install ffmpeg and re-run.",
    );
  }
}

/**
 * Normalize one verified source buffer to a PCM-16 WAV under `profile`: resample,
 * downmix, trim leading and trailing near-silence, loudness- and true-peak-normalize,
 * cap the duration, and encode `pcm_s16le`. `work` is a per-run temporary directory
 * that is created empty and removed afterwards, so no output of a previous run can
 * survive into this one's bytes.
 */
function normalizeClip(profile, clipId, work, srcBytes) {
  const inPath = join(work, `${clipId}.src`);
  const outPath = join(work, `${clipId}.wav`);
  rmSync(inPath, { force: true });
  rmSync(outPath, { force: true });
  writeFileSync(inPath, srcBytes, { mode: 0o644 });

  const filters = [];
  if (profile.trim_silence) {
    // Trim leading and trailing near-silence (the reverse trick trims the tail).
    filters.push(
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02",
      "areverse",
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02",
      "areverse",
    );
  }
  filters.push(
    `loudnorm=I=${profile.loudness_lufs}:TP=${profile.true_peak_dbfs}:LRA=11`,
  );

  const args = [
    "-nostdin",
    "-y",
    "-i",
    inPath,
    "-af",
    filters.join(","),
    "-ar",
    String(profile.sample_rate),
    "-ac",
    String(profile.channels),
    "-t",
    (profile.max_duration_ms / 1000).toFixed(3),
    "-c:a",
    "pcm_s16le",
    outPath,
  ];
  try {
    execFileSync("ffmpeg", args, { stdio: "ignore" });
  } catch (err) {
    fail(`normalizing clip ${clipId} with ffmpeg: ${err.message}`);
  }

  const wav = readFileSync(outPath);
  rmSync(inPath, { force: true });
  rmSync(outPath, { force: true });
  assertPcm16Wav(wav, clipId);
  return wav;
}

/**
 * Abort unless `bytes` is a PCM-16 WAV. The staged image bakes these bytes and the
 * loader decodes them at startup, so a malformed encode has to fail here rather than
 * inside a run container.
 */
function assertPcm16Wav(bytes, clipId) {
  const bad = (why) =>
    fail(`normalized clip ${clipId} is not a PCM-16 WAV (${why})`);
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    bad("missing RIFF/WAVE header");
  }
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = bytes.toString("ascii", off, off + 4);
    const size = bytes.readUInt32LE(off + 4);
    if (id === "fmt " && off + 8 + 16 <= bytes.length) {
      const format = bytes.readUInt16LE(off + 8);
      const bits = bytes.readUInt16LE(off + 8 + 14);
      if (format !== 1) bad(`audio format ${format}, expected 1 (PCM)`);
      if (bits !== 16) bad(`${bits}-bit samples, expected 16`);
      return;
    }
    off += 8 + size + (size % 2);
  }
  bad("no fmt chunk");
}

/** Human-readable one-line summary of a normalize profile. */
function describeProfile(profile) {
  return (
    `${profile.sample_rate}Hz / ${profile.channels}ch / ` +
    `${profile.loudness_lufs} LUFS / TP ${profile.true_peak_dbfs} dBFS / ` +
    `${profile.trim_silence ? "trim" : "no-trim"} / cap ${profile.max_duration_ms}ms`
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPaths = resolveManifestPaths(opts);

  const clips = readClips();
  const lock = readObjectsLock();
  const packs = manifestPaths.map((path) => readPack(path, clips));

  for (const pack of packs) {
    log(
      `pack ${pack.name}@${pack.version} (${pack.kind}) — ${pack.entries.length} entries, profile ${pack.profile_id}`,
    );
    log(`  normalize: ${describeProfile(pack.normalize)}`);
  }

  const { jobs, unpublishedSources } = planPacks(packs, clips, lock);
  const pending = jobs.filter((j) => opts.force || lock[j.key] === undefined);
  log("");
  log(
    `${jobs.length} distinct normalized object${jobs.length === 1 ? "" : "s"}; ` +
      `${jobs.length - pending.length} already in ${basename(OBJECTS_LOCK_PATH)}, ${pending.length} to produce`,
  );
  for (const job of pending)
    log(`  - ${job.key}  (${job.wanted_by.join(", ")})`);

  if (opts.check) {
    log("");
    if (unpublishedSources.size > 0) {
      log(
        `${unpublishedSources.size} clip source object${unpublishedSources.size === 1 ? " is" : "s are"} not in the lock, so a publish would stop on ${unpublishedSources.size === 1 ? "it" : "them"}:`,
      );
      for (const [key, where] of [...unpublishedSources].sort()) {
        log(`  - ${key}  (${where})`);
      }
      log(
        "  Seed them: node scripts/curate-instrument-bank.mjs --seed-sources --publish",
      );
      log("");
    }
    log(
      pending.length === 0
        ? "check OK — every clip resolves and every normalized object is published."
        : `check OK — manifests valid. Run with --publish to produce the ${pending.length} missing object${pending.length === 1 ? "" : "s"}.`,
    );
    return;
  }

  requirePublishedSources(pending, unpublishedSources);
  loadDotEnv();
  const cfg = r2ConfigFromEnv(opts.publish ? "publish" : "presign");

  if (opts.verify) await verifyLocked(cfg, jobs, lock, opts);

  if (pending.length === 0) {
    log("");
    log(
      "nothing to do — every normalized object this pack needs is published.",
    );
    return;
  }

  requireFfmpeg();
  const work = mkdtempSync(join(tmpdir(), "sample-pack-"));
  try {
    for (const job of pending) {
      const src = await getObject({ ...cfg, key: job.source_key });
      const got = sha256(src);
      if (got !== job.clip) {
        fail(
          `${job.source_key} does not hash to its clip id:\n  expected ${job.clip}\n  got      ${got}\n` +
            "  The stored source was replaced out of band; re-ingest the clip.",
        );
      }
      const expected = lock[job.source_key];
      if (expected?.sha256 !== undefined && expected.sha256 !== got) {
        fail(
          `${job.source_key} does not match ${basename(OBJECTS_LOCK_PATH)} (expected ${expected.sha256}, got ${got})`,
        );
      }
      log("");
      log(`${job.clip}: source ${src.length} bytes, verified`);

      const wav = normalizeClip(job.normalize, job.clip, work, src);
      const digest = sha256(wav);
      log(`  normalized -> ${wav.length} bytes, sha256 ${digest}`);

      if (!opts.publish) {
        log(`  not uploaded (pass --publish to upload ${job.key})`);
        continue;
      }
      await putObject({
        ...cfg,
        key: job.key,
        body: wav,
        contentType: "audio/wav",
      });
      lock[job.key] = {
        bucket: cfg.bucket,
        sha256: digest,
        bytes: wav.length,
      };
      writeObjectsLock(lock);
      log(`  uploaded ${cfg.bucket}/${job.key} and recorded it in the lock`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  log("");
  if (opts.publish) {
    log(
      `Commit ${OBJECTS_LOCK_PATH} together with the manifest change, so CI and other`,
    );
    log(
      "machines can stage the audio store with scripts/stage-audio-store.mjs.",
    );
  } else {
    log("Rehearsal complete — nothing was uploaded. Re-run with --publish.");
  }
}

/**
 * Probe every already-locked object with a HEAD, reporting one that is absent from the
 * bucket or whose size disagrees with the lock. Neither is repaired here: an absent
 * normalized object is re-produced with `--force`, and an absent source has to be
 * re-ingested.
 */
async function verifyLocked(cfg, jobs, lock, opts) {
  const keys = new Set();
  for (const job of jobs) {
    for (const key of [job.source_key, job.key]) {
      if (lock[key] !== undefined) keys.add(key);
    }
  }
  log("");
  log(`verifying ${keys.size} locked objects against ${cfg.bucket}`);
  let bad = 0;
  for (const key of [...keys].sort()) {
    const head = await headObject({ ...cfg, key });
    if (head === null) {
      warn(`${key} is recorded in the lock but absent from ${cfg.bucket}`);
      bad++;
      continue;
    }
    const want = lock[key]?.bytes;
    if (
      typeof want === "number" &&
      head.bytes !== null &&
      head.bytes !== want
    ) {
      warn(`${key} is ${head.bytes} bytes in the bucket, ${want} in the lock`);
      bad++;
    }
  }
  if (bad > 0 && !opts.force) {
    fail(
      `${bad} locked object${bad === 1 ? "" : "s"} disagree with the bucket — re-publish with --force, or re-ingest the affected clips`,
    );
  }
  if (bad === 0) log("  all locked objects present and sized as recorded");
}

// An unexpected throw reports its message; set `TCAB_AUDIO_DEBUG=1` for the stack.
main().catch((err) =>
  fail(
    process.env.TCAB_AUDIO_DEBUG
      ? (err?.stack ?? String(err))
      : (err?.message ?? String(err)),
  ),
);
