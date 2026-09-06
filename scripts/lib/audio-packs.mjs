// The `[audio] packs` repository lint's pure core.
//
// Manifest resolution (crates/core) checks a declaration's *shape*: that every ref
// is a pinned `name@version`, that no pack is named twice, and that the count suits
// the case's `asset_kind`. It cannot check the refs against the pack registry,
// because it also runs at backend ingest, where `containers/sample-packs/` is not
// present and the driver has no repository checkout. That is this module's job, and
// it is the only place the two other rules live: that every non-frozen full-stack
// version and every game jam actually declares the key, and that a declared pack is
// one that has been published.
//
// It is Node rather than shell because the published-clip check needs `readPack` and
// the derived 16-hex profile id from `audio-store.mjs`; reimplementing that
// canonicalization in bash would make a second source of truth for the very hashing
// the clip store owns.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

import {
  OBJECTS_LOCK_PATH,
  PACKS_DIR,
  normalizedKey,
  readClips,
  readObjectsLock,
  readPack,
} from "./audio-store.mjs";

/** The manifest filename that marks a test-case version folder. */
const TEST_CASE_MANIFEST = "test-case.toml";

/** The manifest filename that marks a game-jam version folder. */
const GAME_JAM_MANIFEST = "game-jam.toml";

/** The marker file that makes a version directory immutable. */
const FROZEN_MARKER = ".frozen";

/**
 * The two asset kinds that play a pack, mapped to the pack kind each requires and to
 * how the message names it. A `sfx-synth` case plays none, and a full-stack case or
 * jam plays either.
 */
const ASSET_KIND_PACK_KIND = {
  "sfx-sample": "sample-pack",
  music: "instrument-bank",
};

/** The article each pack kind reads with, so a message is a sentence. */
const PACK_KIND_ARTICLE = {
  "sample-pack": "a",
  "instrument-bank": "an",
};

/**
 * Load every pack manifest in `packsDir`, keyed by pack name. Each value is
 * `readPack`'s record plus the normalized object key of every clip it names, which is
 * what the published check compares against the object lock.
 */
export function loadRegistry({
  packsDir = PACKS_DIR,
  clipsPath = join(packsDir, "clips.toml"),
} = {}) {
  const clips = readClips(clipsPath);
  const registry = new Map();
  for (const file of readdirSync(packsDir).sort()) {
    if (!file.endsWith(".toml") || file === "clips.toml") continue;
    const pack = readPack(join(packsDir, file), clips);
    registry.set(pack.name, {
      ...pack,
      file: `containers/sample-packs/${file}`,
      normalizedKeys: pack.entries.map((entry) => ({
        clip: entry.clip,
        key: normalizedKey(entry.clip, pack.profile_id),
      })),
    });
  }
  return registry;
}

/**
 * Split a `name@version` ref. Returns `null` for anything that is not two non-empty
 * halves — the same shape rule manifest resolution enforces, restated here because
 * this lint reads the manifest directly rather than a resolved version.
 */
export function parseRef(ref) {
  if (typeof ref !== "string") return null;
  const at = ref.indexOf("@");
  if (at <= 0 || at === ref.length - 1) return null;
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

/**
 * Every version folder under `root` that carries a test-case or game-jam manifest,
 * as `{ id, dir, manifestPath, frozen, testType, assetKind, packs }`. `packs` is
 * `null` when the version declares no `[audio]` table at all — the case the
 * declaration rule turns on — and an array (possibly empty) when it does. `id` is the
 * version's path relative to `root`, which is how every message names it.
 */
export function discoverVersions({
  root,
  dirs = ["test-cases", "game-jams"],
} = {}) {
  const found = [];
  for (const sub of dirs) {
    const start = join(root, sub);
    if (!existsSync(start)) continue;
    walk(start, found);
  }
  return found
    .map((manifestPath) => readVersion(manifestPath, root))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Collect every manifest path under `dir`, depth-first. */
function walk(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, found);
    } else if (
      entry.name === TEST_CASE_MANIFEST ||
      entry.name === GAME_JAM_MANIFEST
    ) {
      found.push(path);
    }
  }
}

/** Read one manifest into the small record the rules below work on. */
function readVersion(manifestPath, root) {
  const dir = dirname(manifestPath);
  const jam = manifestPath.endsWith(GAME_JAM_MANIFEST);
  const doc = parseToml(readFileSync(manifestPath, "utf8"));
  const audio = doc.audio;
  return {
    id: relative(root, dir).split(sep).join("/"),
    dir,
    manifestPath,
    frozen: existsSync(join(dir, FROZEN_MARKER)),
    // The folder and filename decide a jam; a test case states its type, defaulting
    // to end-to-end exactly as the manifest schema does.
    testType: jam ? "game-jam" : (doc.type ?? "end-to-end"),
    assetKind: doc.asset_kind ?? "sprite",
    packs:
      audio === undefined || audio === null
        ? null
        : Array.isArray(audio.packs)
          ? audio.packs
          : [],
  };
}

/**
 * Check one version against the registry and the object lock, returning
 * `{ errors, defaults }`. `defaults` is the `packKind -> ref` map the version's order
 * resolves to (empty for a version that declares nothing), which the CLI prints so a
 * reordering shows up in a CI log as well as in the manifest diff.
 */
export function checkVersion(version, registry, published) {
  const errors = [];
  const at = version.id;
  const declares =
    version.testType === "full-stack" || version.testType === "game-jam";

  if (version.packs === null) {
    // A frozen version predates the key and cannot be edited; it takes the pinned
    // default in core. Every other one states its palette, so publishing a pack
    // cannot silently widen what an existing case reaches.
    if (declares && !version.frozen) {
      errors.push(
        `${at}: a ${version.testType} version that is not frozen must declare ` +
          "[audio] packs (the full set, or the subset this case needs)",
      );
    }
    return { errors, defaults: {} };
  }

  const defaults = {};
  for (const ref of version.packs) {
    const parsed = parseRef(ref);
    // A malformed ref is manifest resolution's rule and its message; skip it here
    // rather than reporting the same fault twice in two wordings.
    if (parsed === null) continue;
    const pack = registry.get(parsed.name);
    if (pack === undefined) {
      errors.push(
        `${at}: audio.packs names \`${ref}\`; containers/sample-packs/ has no pack ` +
          `\`${parsed.name}\``,
      );
      continue;
    }
    if (pack.version !== parsed.version) {
      errors.push(
        `${at}: audio.packs pins \`${ref}\`; ${pack.file} is version ${pack.version}`,
      );
      continue;
    }
    const wanted = ASSET_KIND_PACK_KIND[version.assetKind];
    if (wanted !== undefined && pack.kind !== wanted) {
      errors.push(
        `${at}: a \`${version.assetKind}\` case's pack must be ` +
          `${PACK_KIND_ARTICLE[wanted]} ${wanted}; \`${pack.name}\` is ` +
          `${PACK_KIND_ARTICLE[pack.kind]} ${pack.kind}`,
      );
      continue;
    }
    const missing = pack.normalizedKeys.find(
      (entry) => !Object.hasOwn(published, entry.key),
    );
    if (missing !== undefined) {
      errors.push(
        `${at}: audio.packs names \`${ref}\`, whose clip ${missing.clip} is not ` +
          "published: containers/sample-packs/objects.lock.json has no record of " +
          missing.key,
      );
      continue;
    }
    // First of a kind wins: that is the pack a tool config naming none plays.
    if (defaults[pack.kind] === undefined) defaults[pack.kind] = ref;
  }
  return { errors, defaults };
}

/**
 * Check every version under `root`. Returns `{ errors, versions }`, where `versions`
 * carries each checked version beside the defaults its order resolves to.
 */
export function checkRepository({
  root,
  packsDir = PACKS_DIR,
  objectsLockPath = OBJECTS_LOCK_PATH,
} = {}) {
  const registry = loadRegistry({ packsDir });
  const published = readObjectsLock(objectsLockPath);
  const errors = [];
  const versions = [];
  for (const version of discoverVersions({ root })) {
    const result = checkVersion(version, registry, published);
    errors.push(...result.errors);
    versions.push({ ...version, defaults: result.defaults });
  }
  return { errors, versions };
}

/** The repository root this checkout is in (the parent of `scripts/`). */
export function repositoryRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
