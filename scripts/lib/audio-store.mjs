// The audio clip store's data model: the clip registry, the object lock, the
// normalization profile identity, the object keys, and the pack manifests that name
// clips by id.
//
// Three committed files describe every piece of audio the run-container images bake,
// and this module is the only place that reads or writes them:
//
//   - `containers/sample-packs/clips.toml` — the CLIP REGISTRY. One entry per audio
//     source, keyed by `id`, the sha256 of the original source bytes. It records only
//     intrinsic facts (license, provenance, the recorded pitch), never presentation:
//     the same clip is `trombone` in one pack and `low_brass` in another.
//   - `containers/sample-packs/<pack>.toml` — a PACK, a named, ordered collection of
//     clip ids plus the presentation each pack wants for them, and the `[normalize]`
//     profile its renditions are rendered with.
//   - `containers/sample-packs/objects.lock.json` — the OBJECT LOCK, what has actually
//     been published to the private R2 bucket, so a build fails fast with a good
//     message instead of a 404 mid-run.
//
// The object store holds two kinds of object, addressed purely by content identity:
// `sources/<clip-id>` (the original bytes, uploaded once at ingest) and
// `normalized/<clip-id>/<profile-id>.wav` (one rendition of that clip under one
// normalization profile). Two packs asking for the same clip under the same profile
// name the same object, so the bytes are stored once and staged once.
//
// Every function here throws a `TypeError`-free plain `Error` carrying the offending
// file path; callers are scripts that print `err.message` and exit non-zero.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directory holding the clip registry, the object lock, and every pack manifest. */
export const PACKS_DIR = join(repoRoot, "containers", "sample-packs");

/** The committed clip registry. */
export const CLIPS_PATH = join(PACKS_DIR, "clips.toml");

/** The committed record of what has been published to the object store. */
export const OBJECTS_LOCK_PATH = join(PACKS_DIR, "objects.lock.json");

/** The two pack kinds: an `sfx-sample` sample library, or a `music` instrument bank. */
export const PACK_KINDS = new Set(["sample-pack", "instrument-bank"]);

/** Resolve `<pack>` or `<pack>.toml` to its manifest path under `PACKS_DIR`. */
export function packPath(pack) {
  const stem = pack.endsWith(".toml") ? pack.slice(0, -5) : pack;
  return join(PACKS_DIR, `${stem}.toml`);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A clip's identity: the sha256 of its original source bytes, lowercase hex. */
export function clipId(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `sources/<clip-id>` — the original bytes of one clip. */
export function sourceKey(clipId) {
  requireClipId(clipId, "sourceKey");
  return `sources/${clipId}`;
}

/** `normalized/<clip-id>/<profile-id>.wav` — one clip rendered under one profile. */
export function normalizedKey(clipId, profileId) {
  requireClipId(clipId, "normalizedKey");
  if (!/^[0-9a-f]{16}$/.test(profileId ?? "")) {
    throw new Error(
      `normalizedKey: profile id must be 16 lowercase hex chars, got "${profileId}"`,
    );
  }
  return `normalized/${clipId}/${profileId}.wav`;
}

function requireClipId(id, where) {
  if (typeof id !== "string" || !HEX64.test(id)) {
    throw new Error(
      `${where}: clip id must be 64 lowercase hex chars, got "${id}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Normalization profiles
// ---------------------------------------------------------------------------

/** Field defaults for a pack that omits `[normalize]` or one of its fields. */
const NORMALIZE_DEFAULTS = {
  sample_rate: 44100,
  channels: 1,
  loudness_lufs: -23,
  true_peak_dbfs: -1,
  trim_silence: true,
  max_duration_ms: 5000,
};

/** The six fields a profile is made of, in the order the canonical encoding uses. */
const PROFILE_FIELDS = [
  "sample_rate",
  "channels",
  "loudness_lufs",
  "true_peak_dbfs",
  "trim_silence",
  "max_duration_ms",
];

/**
 * Fill defaults into a raw `[normalize]` table and validate it, returning a profile
 * with exactly the six profile fields. Every consumer works on this shape, so a pack
 * that spells a value `-20.0` and one that spells it `-20` produce the same profile.
 */
export function normalizeProfile(raw = {}, where = "normalize") {
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    profile[field] =
      raw[field] === undefined ? NORMALIZE_DEFAULTS[field] : raw[field];
  }

  for (const field of ["sample_rate", "channels", "max_duration_ms"]) {
    if (!Number.isInteger(profile[field]) || profile[field] <= 0) {
      throw new Error(
        `${where}: ${field} must be a positive integer, got ${JSON.stringify(profile[field])}`,
      );
    }
  }
  for (const field of ["loudness_lufs", "true_peak_dbfs"]) {
    if (
      typeof profile[field] !== "number" ||
      !Number.isFinite(profile[field])
    ) {
      throw new Error(
        `${where}: ${field} must be a finite number, got ${JSON.stringify(profile[field])}`,
      );
    }
  }
  if (typeof profile.trim_silence !== "boolean") {
    throw new Error(
      `${where}: trim_silence must be a boolean, got ${JSON.stringify(profile.trim_silence)}`,
    );
  }
  if (profile.channels !== 1 && profile.channels !== 2) {
    throw new Error(
      `${where}: channels must be 1 or 2, got ${profile.channels}`,
    );
  }

  return profile;
}

/**
 * Encode one number canonically so the profile id depends on the VALUE and not on how
 * a TOML author spelled it. `-20.0`, `-20` and `-2e1` all encode as `-20`; `-0`
 * encodes as `0`.
 */
function canonicalNumber(value) {
  return Object.is(value, -0) ? "0" : String(value);
}

/**
 * The identity of a normalization profile: the first 16 hex chars of the sha256 of
 * its canonical encoding, which is the six profile fields in a fixed order joined by
 * `|`, with booleans as `true`/`false` and numbers in canonical form:
 *
 *     sample_rate|channels|loudness_lufs|true_peak_dbfs|trim_silence|max_duration_ms
 *
 * The gm-lite profile therefore encodes as `44100|2|-20|-1|true|5000`. The field order
 * is fixed by this module rather than by the manifest, so key order in the TOML never
 * changes the id, and the numeric canonicalization means a reformatted manifest never
 * invalidates published renditions.
 */
export function profileId(normalize) {
  const profile = normalizeProfile(normalize, "profileId");
  const canonical = PROFILE_FIELDS.map((field) => {
    const value = profile[field];
    return typeof value === "boolean" ? String(value) : canonicalNumber(value);
  }).join("|");
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// The clip registry
// ---------------------------------------------------------------------------

/**
 * Read and validate the clip registry, returning `Map<clipId, clip>` in registry
 * order. Each clip carries its `id`, `license`, `source_url`, and whatever optional
 * provenance and pitch fields it declares (`freesound_id`, `root_note`); unknown
 * fields are preserved so the registry can grow without this module changing.
 */
export function readClips(path = CLIPS_PATH) {
  const doc = readTomlFile(path);
  const rows = doc.clip ?? [];
  if (!Array.isArray(rows)) {
    throw new Error(`${path}: "clip" must be an array of [[clip]] tables`);
  }

  const clips = new Map();
  rows.forEach((row, i) => {
    const where = `${path} [[clip]] #${i + 1}`;
    const id = row?.id;
    if (typeof id !== "string" || !HEX64.test(id)) {
      throw new Error(
        `${where}: id must be 64 lowercase hex chars (the sha256 of the source bytes), got ${JSON.stringify(id)}`,
      );
    }
    if (clips.has(id)) {
      throw new Error(`${where}: duplicate clip id ${id}`);
    }
    for (const field of ["license", "source_url"]) {
      if (typeof row[field] !== "string" || row[field].length === 0) {
        throw new Error(
          `${where} (${id}): missing required string field "${field}"`,
        );
      }
    }
    if (row.root_note !== undefined) {
      assertMidiNote(row.root_note, `${where} (${id})`);
    }
    clips.set(id, { ...row, id });
  });

  return clips;
}

/**
 * Write the clip registry, sorted by clip id so a diff shows only the clips that
 * changed. Accepts the `Map` `readClips` returns or any iterable of clip objects.
 */
export function writeClips(clips, path = CLIPS_PATH) {
  const rows = [...(clips instanceof Map ? clips.values() : clips)];
  const seen = new Set();
  for (const row of rows) {
    requireClipId(row?.id, "writeClips");
    if (seen.has(row.id))
      throw new Error(`writeClips: duplicate clip id ${row.id}`);
    seen.add(row.id);
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const header = [
    "# Clip registry — every audio source the sample packs draw on.",
    "#",
    "# `id` is the sha256 of the original source bytes and is the clip's identity: it",
    "# names `sources/<id>` in the object store and is what a pack entry's `clip` field",
    "# points at. Only intrinsic facts belong here; a clip's name, tags and description",
    "# are per-pack.",
    "#",
    "# Generated by the audio tooling and sorted by id. Edit through the tooling.",
    "",
  ].join("\n");

  writeFileSync(path, `${header}\n${stringifyToml({ clip: rows })}\n`, "utf8");
}

function assertMidiNote(value, where) {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new Error(
      `${where}: root_note must be a MIDI integer 0..127, got ${JSON.stringify(value)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The object lock
// ---------------------------------------------------------------------------

/**
 * Read the object lock: `{ "<object key>": { bucket, sha256, bytes } }`. A missing
 * file reads as an empty lock, so a fresh checkout of the tooling works before
 * anything has been published.
 */
export function readObjectsLock(path = OBJECTS_LOCK_PATH) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`reading ${path}: ${err.message}`);
  }
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (err) {
    throw new Error(`parsing ${path}: ${err.message}`);
  }
  if (lock === null || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error(`${path}: expected a JSON object of object key -> record`);
  }
  return lock;
}

/** Write the object lock with its keys sorted, so a publish shows a minimal diff. */
export function writeObjectsLock(lock, path = OBJECTS_LOCK_PATH) {
  const sorted = {};
  for (const key of Object.keys(lock).sort()) sorted[key] = lock[key];
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

const LEGACY_MIGRATION = [
  "packs are now collections of clip ids, not of URLs.",
  "Migrate it by moving each entry's license/url/sha256 into the clip registry",
  `(${CLIPS_PATH}) as an [[clip]] whose id is the entry's old sha256 and whose`,
  "source_url is its old url, then replacing each [[sample]]/[[instrument]] table",
  'with an [[entry]] carrying clip = "<that id>" plus name/tags/description.',
  "See containers/sample-packs/README.md.",
].join(" ");

/**
 * Read and validate one pack manifest, returning
 * `{ path, name, version, kind, normalize, profile_id, entries }`. Every entry names a
 * clip present in `clips`, entry names are unique within the pack, and a pack carries
 * no source bytes of its own.
 */
export function readPack(path, clips = readClips()) {
  const doc = readTomlFile(path);

  if (Array.isArray(doc.sample) || Array.isArray(doc.instrument)) {
    throw new Error(
      `${path}: legacy pack format ([[sample]] / [[instrument]] tables) — ${LEGACY_MIGRATION}`,
    );
  }

  const name = requireString(doc, "name", path);
  const version = requireString(doc, "version", path);
  const kind = doc.kind === undefined ? "sample-pack" : doc.kind;
  if (!PACK_KINDS.has(kind)) {
    throw new Error(
      `${path}: kind must be one of ${[...PACK_KINDS].join(", ")}, got ${JSON.stringify(kind)}`,
    );
  }

  const normalize = normalizeProfile(
    doc.normalize ?? {},
    `${path} [normalize]`,
  );

  const rows = doc.entry ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${path}: no [[entry]] tables`);
  }

  const names = new Set();
  const entries = rows.map((row, i) => {
    const where = `${path} [[entry]] #${i + 1}`;
    const entryName = requireString(row, "name", where);
    if (names.has(entryName)) {
      throw new Error(`${where}: duplicate entry name "${entryName}"`);
    }
    names.add(entryName);

    const at = `${where} (${entryName})`;
    for (const field of ["url", "sha256", "license"]) {
      if (row[field] !== undefined) {
        throw new Error(
          `${at}: "${field}" belongs to the clip, not the pack — ${LEGACY_MIGRATION}`,
        );
      }
    }

    const clip = requireString(row, "clip", at);
    if (!HEX64.test(clip)) {
      throw new Error(
        `${at}: clip must be a 64 lowercase hex clip id, got "${clip}"`,
      );
    }
    if (!clips.has(clip)) {
      throw new Error(
        `${at}: clip ${clip} is not in the clip registry (${CLIPS_PATH}) — ingest it before naming it`,
      );
    }

    if (row.root_note !== undefined) assertMidiNote(row.root_note, at);
    if (row.pitched !== undefined && typeof row.pitched !== "boolean") {
      throw new Error(
        `${at}: pitched must be a boolean, got ${JSON.stringify(row.pitched)}`,
      );
    }
    if (row.tags !== undefined && !Array.isArray(row.tags)) {
      throw new Error(`${at}: tags must be an array of strings`);
    }

    return {
      clip,
      name: entryName,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      description: typeof row.description === "string" ? row.description : "",
      pitched: row.pitched,
      root_note: row.root_note,
    };
  });

  return {
    path,
    name,
    version,
    kind,
    normalize,
    profile_id: profileId(normalize),
    entries,
  };
}

/**
 * Resolve one pack entry against the registry into the full record the staging and
 * browse paths need. The registry supplies the clip's intrinsic facts and its
 * detected `root_note`; the pack overrides `root_note` when it wants the clip
 * transposed from a different reference pitch. `pitched` defaults to true, matching
 * the loader.
 */
export function resolveEntry(pack, entry, clips = readClips()) {
  const clip = clips.get(entry.clip);
  if (clip === undefined) {
    throw new Error(
      `${pack.name}: entry "${entry.name}" names clip ${entry.clip}, which is not in the clip registry (${CLIPS_PATH})`,
    );
  }
  const rootNote = entry.root_note ?? clip.root_note;
  return {
    clip: clip.id,
    name: entry.name,
    tags: entry.tags,
    description: entry.description,
    pitched: entry.pitched ?? true,
    root_note: rootNote,
    license: clip.license,
    source_url: clip.source_url,
    profile_id: pack.profile_id,
    source_key: sourceKey(clip.id),
    normalized_key: normalizedKey(clip.id, pack.profile_id),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readTomlFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`reading ${path}: ${err.message}`);
  }
  try {
    return parseToml(raw);
  } catch (err) {
    throw new Error(`parsing ${path}: ${err.message}`);
  }
}

function requireString(obj, key, where) {
  const value = obj?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where}: missing required string field "${key}"`);
  }
  return value;
}
