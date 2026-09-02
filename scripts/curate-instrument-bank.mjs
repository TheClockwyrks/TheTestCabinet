// Ingest CC0 audio clips from Freesound into The Test Cabinet's clip store.
//
// This is the ONE-TIME INGEST STEP, and the only script in the repository that
// contacts freesound.org. It runs on a developer's machine, once per clip. Everything
// downstream — normalization, publishing, image staging, CI — reads clip bytes from
// The Test Cabinet's own object store by clip id, so a clip that has been ingested
// once is never fetched from Freesound again.
//
// A clip's identity is `sha256(original bytes)`, lowercase hex. Ingest fetches the
// bytes, derives that id, uploads them to `sources/<clip-id>` (with `--publish`),
// records the object in `containers/sample-packs/objects.lock.json`, and writes the
// clip's intrinsic facts (license, provenance, recorded pitch) into the clip registry
// `containers/sample-packs/clips.toml`. A clip already in the registry is reused
// rather than duplicated.
//
// Three modes:
//
//   BANK CURATION (`--bank <name>`) fills a whole instrument bank. The `music`
//   sequencer plays a bank instrument by pitch-shifting one recorded note across a
//   track's notes (see `crates/audio-core/src/music.rs`), so each entry needs the MIDI
//   note it was recorded at. That note can be ANY pitch as long as it is recorded
//   accurately, so for each instrument in the bank's spec this mode searches Freesound
//   (CC0 only), downloads the candidate's hq-ogg preview, DETECTS the fundamental by
//   autocorrelation, and records it as the clip's `root_note`. Percussion is marked
//   `pitched = false` in the bank (played native, never transposed) and skips pitch
//   detection. The bank manifest `containers/sample-packs/<bank>.toml` is then written
//   as a collection of clip ids: each `[[entry]]` carries `clip`, `name`, `tags`,
//   `description` and, for percussion, `pitched = false`. A pack carries no `url` and
//   no `sha256`; those belong to the clip.
//
//   SINGLE-CLIP INGEST (`--ingest <url|freesound-id>`) ingests one named source
//   without curating a bank. This is how a developer back-fills a clip that a pack
//   already references but whose bytes are not yet in the object store, and how a
//   hand-picked sound enters the registry.
//
//   SOURCE SEEDING (`--seed-sources`) moves every clip the registry already pins into
//   the object store in one pass. It reads `containers/sample-packs/clips.toml` as its
//   work list rather than searching Freesound, so it never changes which clips a pack
//   references. For each clip whose `sources/<clip-id>` object the lock does not
//   record, it fetches the clip's recorded `source_url`, verifies the bytes hash to
//   exactly that clip id, and with `--publish` uploads the object and records it. A
//   clip already in the lock is skipped, so the mode is resumable and idempotent; a
//   hash mismatch or a failed fetch is a per-clip error naming the clip and its URL,
//   and the run continues through the remaining clips and exits non-zero with a
//   summary. Once it has run, a development environment reaches freesound.org no
//   further: publishing a pack and building an audio image read the object store.
//
// `--bank` and `--ingest` need `FREESOUND_API_KEY` (repo-root `.env`), and `ffmpeg` on
// PATH whenever a pitch has to be detected (to decode the ogg preview to PCM).
// `--seed-sources` needs neither, because the URLs the registry records are the preview
// CDN's. `--publish` additionally needs the write-scoped R2 credentials. Freesound
// search is token-tier; the preview CDN needs no auth.
//
// Usage:
//   node scripts/curate-instrument-bank.mjs --bank gm-lite --publish
//   node scripts/curate-instrument-bank.mjs --bank cinematic --dry-run
//   node scripts/curate-instrument-bank.mjs --ingest <freesound-url> --publish
//   node scripts/curate-instrument-bank.mjs --ingest 388546 --unpitched --publish
//   node scripts/curate-instrument-bank.mjs --seed-sources
//   node scripts/curate-instrument-bank.mjs --seed-sources --publish

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

import { loadDotEnv } from "./lib/env.mjs";
import {
  CLIPS_PATH,
  OBJECTS_LOCK_PATH,
  clipId,
  packPath,
  readClips,
  readObjectsLock,
  sourceKey,
  writeClips,
  writeObjectsLock,
} from "./lib/audio-store.mjs";
import { putObject, r2ConfigFromEnv } from "./lib/r2.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(repoRoot, "dist", "sample-packs", ".curate-cache");

const CC0_SPDX = "CC0-1.0";

// Freesound reports a license as its deed URL. Only the CC0 waiver is ingested, so a
// source whose deed is anything else is rejected outright.
const CC0_DEED = /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/;
const isCC0 = (license) => CC0_DEED.test(license ?? "");

// The MIDI note recorded for an unpitched one-shot. It is never used to transpose (a
// percussion entry sets `pitched = false` and plays native), but the registry records
// a value so every clip reads the same shape.
const UNPITCHED_ROOT_NOTE = 60;

// The desired bank: a GM-flavoured spread across families, each with a Freesound query
// and (for melodic instruments) a plausible MIDI range to reject chords / octave
// errors / garbage. `pitched: false` entries are percussion one-shots. Descriptions
// name the instrument (a `music` case measures composition, not identification, so a
// real instrument name is correct — unlike the neutral sfx sample library).
const GM_LITE_SPEC = [
  // Keys
  inst(
    "grand_piano",
    "piano note",
    ["keys", "piano"],
    "A single sustained acoustic grand-piano note.",
    [36, 96],
  ),
  inst(
    "electric_piano",
    "rhodes electric piano note",
    ["keys", "electric-piano"],
    "A mellow electric-piano (Rhodes-style) note.",
    [40, 88],
  ),
  inst(
    "music_box",
    "music box single note",
    ["keys", "bells"],
    "A delicate music-box note with a bright bell-like attack.",
    [60, 100],
  ),
  // Guitar / bass
  inst(
    "nylon_guitar",
    "nylon classical guitar note",
    ["guitar", "plucked"],
    "A plucked nylon-string classical-guitar note.",
    [40, 88],
  ),
  inst(
    "electric_guitar",
    "electric guitar clean single note",
    ["guitar", "electric"],
    "A clean electric-guitar note.",
    [40, 88],
  ),
  inst(
    "bass_electric",
    "electric bass single note",
    ["bass", "plucked"],
    "A round electric-bass note.",
    [28, 67],
  ),
  // Strings
  inst(
    "violin",
    "violin note",
    ["strings", "bowed"],
    "A sustained bowed-violin note.",
    [55, 100],
  ),
  inst(
    "cello",
    "cello note",
    ["strings", "bowed"],
    "A sustained bowed-cello note.",
    [36, 76],
  ),
  inst(
    "string_ensemble",
    "string ensemble",
    ["strings", "ensemble", "pad"],
    "A warm sustained string-ensemble note.",
    [48, 84],
  ),
  // Brass
  inst(
    "trumpet",
    "trumpet single note",
    ["brass"],
    "A bright sustained trumpet note.",
    [52, 88],
  ),
  inst(
    "trombone",
    "trombone single note",
    ["brass"],
    "A round sustained trombone note.",
    [40, 72],
  ),
  inst(
    "french_horn",
    "french horn single note",
    ["brass"],
    "A mellow sustained french-horn note.",
    [41, 77],
  ),
  // Woodwind
  inst(
    "flute",
    "flute note",
    ["woodwind"],
    "A breathy sustained flute note.",
    [60, 96],
  ),
  inst(
    "clarinet",
    "clarinet single note",
    ["woodwind"],
    "A woody sustained clarinet note.",
    [50, 90],
  ),
  inst(
    "saxophone",
    "saxophone note",
    ["woodwind", "reed"],
    "A reedy sustained saxophone note.",
    [49, 85],
  ),
  // Mallets
  inst(
    "marimba",
    "marimba",
    ["mallets", "tuned-percussion"],
    "A warm wooden marimba note with a soft mallet attack.",
    [45, 96],
  ),
  inst(
    "vibraphone",
    "vibraphone note",
    ["mallets", "tuned-percussion"],
    "A shimmering metallic vibraphone note.",
    [53, 96],
  ),
  inst(
    "glockenspiel",
    "glockenspiel single note",
    ["mallets", "bells"],
    "A bright metallic glockenspiel note.",
    [72, 108],
  ),
  // Synth
  inst(
    "synth_lead",
    "synth lead",
    ["synth", "lead"],
    "A bright sawtooth synth-lead note.",
    [40, 96],
  ),
  inst(
    "synth_pad",
    "synth pad",
    ["synth", "pad"],
    "A soft sustained synth-pad note.",
    [40, 88],
  ),
  // Percussion (unpitched one-shots)
  perc(
    "drum_kick",
    "kick drum one shot",
    ["drum", "percussion", "kick"],
    "A tight acoustic kick-drum one-shot.",
  ),
  perc(
    "drum_snare",
    "acoustic snare drum one shot",
    ["drum", "percussion", "snare"],
    "A crisp acoustic snare-drum one-shot.",
  ),
  perc(
    "drum_hat_closed",
    "closed hi-hat one shot",
    ["drum", "percussion", "hihat"],
    "A short closed hi-hat tick.",
  ),
  perc(
    "drum_clap",
    "hand clap one shot",
    ["percussion", "clap"],
    "A single hand-clap one-shot.",
  ),
  perc(
    "drum_tom",
    "tom drum one shot",
    ["drum", "percussion", "tom"],
    "A rounded tom-drum one-shot.",
  ),
  perc(
    "drum_crash",
    "crash cymbal one shot",
    ["drum", "percussion", "cymbal"],
    "A bright crash-cymbal one-shot.",
  ),
];

// A domain-tailored EPIC ORCHESTRAL bank for trailer/boss/cinematic cues — the big
// voices gm-lite lacks: sectioned strings (staccato, tremolo, pizzicato), heroic brass,
// mixed choir, and thunderous orchestral percussion.
const CINEMATIC_SPEC = [
  // Strings
  inst("staccato_strings", "staccato strings", ["strings", "staccato", "cinematic"], "A short, sharp staccato string-section stab.", [48, 88]),
  inst("tremolo_strings", "tremolo strings", ["strings", "tremolo", "tension"], "A tense sustained tremolo string note.", [48, 88]),
  inst("string_ensemble", "string ensemble", ["strings", "ensemble", "pad"], "A lush sustained string-ensemble note.", [48, 84]),
  inst("solo_cello", "cello note", ["strings", "bowed", "solo"], "An expressive sustained solo-cello note.", [36, 74]),
  inst("pizzicato_strings", "pizzicato strings", ["strings", "pizzicato", "plucked"], "A short plucked pizzicato string note.", [40, 84]),
  // Brass
  inst("horns", "french horn", ["brass", "horns"], "A bold sustained french-horn note.", [40, 77]),
  inst("low_brass", "trombone note", ["brass", "low"], "A heavy sustained low-brass note.", [36, 67]),
  inst("trumpet", "trumpet note", ["brass"], "A bright, heroic sustained trumpet note.", [52, 88]),
  // Choir
  inst("choir_aah", "choir aah", ["choir", "voice", "aah"], "A sustained mixed-choir 'aah' vowel.", [48, 84]),
  inst("choir_ooh", "choir ooh", ["choir", "voice", "ooh"], "A sustained mixed-choir 'ooh' vowel.", [48, 84]),
  // Woodwind
  inst("oboe", "oboe note", ["woodwind", "reed"], "A plaintive sustained oboe note.", [58, 91]),
  inst("flute", "flute note", ["woodwind"], "A breathy sustained flute note.", [60, 96]),
  // Keys / plucked
  inst("celesta", "celesta", ["mallets", "bells", "keys"], "A delicate, bell-like celesta note.", [60, 108]),
  inst("harp", "harp note", ["plucked", "harp"], "A resonant plucked-harp note.", [36, 96]),
  // Percussion (unpitched one-shots)
  perc("timpani", "timpani", ["percussion", "timpani", "drum"], "A deep, resonant orchestral timpani hit."),
  perc("taiko", "taiko", ["percussion", "taiko", "drum"], "A thunderous taiko drum hit."),
  perc("bass_drum", "orchestral bass drum", ["percussion", "drum", "low"], "A deep orchestral bass-drum hit."),
  perc("cymbal", "cymbal crash", ["percussion", "cymbal"], "A large orchestral cymbal crash."),
  perc("orchestral_hit", "orchestral hit", ["percussion", "hit", "stab"], "A punchy full-orchestra hit/stab."),
];

// A domain-tailored SYNTHWAVE / ELECTRONIC bank for retro-synth, EDM, and lo-fi cues —
// analog leads and basses, pads, FM bells, and an electronic drum machine.
const SYNTHWAVE_SPEC = [
  // Leads / plucks
  inst("saw_lead", "saw synth", ["synth", "lead", "saw"], "A bright sawtooth synth-lead note.", [40, 96]),
  inst("square_lead", "square synth", ["synth", "lead", "square"], "A hollow square-wave synth note.", [40, 96]),
  inst("pluck", "synth pluck", ["synth", "pluck"], "A short, bright synth-pluck note.", [40, 96]),
  // Bass
  inst("synth_bass", "synth bass", ["synth", "bass"], "A round analog synth-bass note.", [28, 60]),
  inst("sub_bass", "sub bass", ["synth", "bass", "sub"], "A deep sub-bass synth note.", [24, 55]),
  // Pads / keys
  inst("warm_pad", "synth pad", ["synth", "pad"], "A warm sustained synth-pad note.", [40, 88]),
  inst("analog_pad", "analog pad", ["synth", "pad", "analog"], "A lush analog synth-pad note.", [40, 88]),
  inst("fm_bell", "fm bell", ["synth", "bell", "fm"], "A glassy FM synth-bell note.", [52, 96]),
  inst("synth_brass", "synth brass", ["synth", "brass"], "A punchy synth-brass note.", [40, 84]),
  inst("synth_strings", "synth strings", ["synth", "strings", "pad"], "A shimmering synth-strings note.", [48, 84]),
  // Percussion (unpitched one-shots)
  perc("kick_808", "808 kick", ["drum", "kick", "808", "electronic"], "A deep, booming 808-style kick."),
  perc("snare_electronic", "electronic snare", ["drum", "snare", "electronic"], "A snappy electronic snare."),
  perc("clap", "clap one shot", ["drum", "clap", "electronic"], "A tight electronic hand-clap."),
  perc("hat_closed", "closed hihat", ["drum", "hihat", "electronic"], "A crisp electronic closed hi-hat."),
  perc("hat_open", "open hihat", ["drum", "hihat", "open", "electronic"], "A sizzling electronic open hi-hat."),
  perc("tom_electronic", "electronic tom", ["drum", "tom", "electronic"], "A synthetic electronic tom."),
];

// The bank registry. Each bank names its manifest (`<name>.toml`), the `version` a
// fresh manifest starts at, a one-line `blurb` and the noun its unpitched entries go
// by for the manifest header, and its instrument `spec`.
const BANKS = {
  "gm-lite": {
    name: "gm-lite",
    version: "0.1.0",
    blurb: "A general-MIDI-flavoured instrument bank",
    percussion: "percussion",
    spec: GM_LITE_SPEC,
  },
  cinematic: {
    name: "cinematic",
    version: "0.1.0",
    blurb: "An epic-orchestral instrument bank (strings, brass, choir, orchestral percussion)",
    percussion: "percussion",
    spec: CINEMATIC_SPEC,
  },
  synthwave: {
    name: "synthwave",
    version: "0.1.0",
    blurb: "A synthwave / electronic instrument bank (analog synths, pads, drum machine)",
    percussion: "drum-machine",
    spec: SYNTHWAVE_SPEC,
  },
};

function inst(name, query, tags, description, range) {
  return { name, query, tags, description, pitched: true, range };
}
function perc(name, query, tags, description) {
  return { name, query, tags, description, pitched: false };
}

function log(m) {
  process.stdout.write(`${m}\n`);
}
function warn(m) {
  process.stderr.write(`WARN: ${m}\n`);
}
function fail(m) {
  process.stderr.write(`ERROR: ${m}\n`);
  process.exit(1);
}

const HELP = `curate-instrument-bank — the one-time Freesound ingest step

Usage:
  node scripts/curate-instrument-bank.mjs --bank <${Object.keys(BANKS).join("|")}> [--publish]
  node scripts/curate-instrument-bank.mjs --ingest <url|freesound-id> [--ingest ...] [--publish]
  node scripts/curate-instrument-bank.mjs --seed-sources [--publish] [--force]

Options:
  --bank <name>      curate a whole instrument bank from its spec (default gm-lite)
  --ingest <src>     ingest one clip named by preview URL, sound URL, or Freesound id,
                     without curating a bank; repeatable
  --seed-sources     seed sources/<clip-id> for every clip in the clip registry that the
                     object lock does not already record, fetching each clip's recorded
                     source_url and verifying the bytes against its id; no search runs
                     and no pack changes which clips it references
  --publish          upload each clip's original bytes to sources/<clip-id> and record
                     them in objects.lock.json (needs the write-scoped R2 credentials)
  --force            with --seed-sources, re-fetch and re-upload clips the lock records
  --root-note <midi> record this pitch for an ingested clip instead of detecting it
  --unpitched        ingest a percussion one-shot: skip pitch detection
  --version <x.y.z>  version to write into the bank manifest
  --dry-run          search and detect only; write nothing and upload nothing
  --per <n>          candidates to consider per instrument (default 8)
  --out <path>       bank manifest to write (default containers/sample-packs/<bank>.toml)

This is the only script that contacts freesound.org, and it is a developer-local step
run once per clip. --bank and --ingest need FREESOUND_API_KEY (repo-root .env), and
ffmpeg on PATH whenever a pitch has to be detected; --seed-sources needs neither.

--seed-sources is the one-time bootstrap that moves the pinned clips into The Test
Cabinet's own object store. After it has run, nothing reaches freesound.org again:
publishing a pack and building an audio image read the store by clip id.`;

function parseArgs(argv) {
  const o = {
    dryRun: false,
    per: 8,
    out: null,
    bank: "gm-lite",
    bankGiven: false,
    ingest: [],
    seedSources: false,
    force: false,
    publish: false,
    rootNote: null,
    unpitched: false,
    version: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--publish") o.publish = true;
    else if (a === "--seed-sources") o.seedSources = true;
    else if (a === "--force") o.force = true;
    else if (a === "--unpitched") o.unpitched = true;
    else if (a === "--per") o.per = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--version") o.version = argv[++i];
    else if (a === "--root-note") o.rootNote = Number(argv[++i]);
    else if (a === "--ingest") {
      const src = argv[++i];
      if (!src) fail("--ingest needs a source URL or Freesound id");
      o.ingest.push(src);
    } else if (a === "--bank") {
      o.bank = argv[++i];
      o.bankGiven = true;
    } else if (a === "--help" || a === "-h") {
      log(HELP);
      process.exit(0);
    } else fail(`unknown arg ${a} (try --help)`);
  }
  if (o.ingest.length > 0 && o.bankGiven) {
    fail("--ingest ingests one clip and --bank curates a whole bank; pass one or the other");
  }
  if (o.seedSources && (o.ingest.length > 0 || o.bankGiven)) {
    fail(
      "--seed-sources seeds the clips the registry already pins; it takes neither " +
        "--bank nor --ingest",
    );
  }
  if (o.force && !o.seedSources) {
    fail("--force applies to --seed-sources");
  }
  if (o.rootNote !== null && (!Number.isInteger(o.rootNote) || o.rootNote < 0 || o.rootNote > 127)) {
    fail(`--root-note must be a MIDI integer 0..127, got ${o.rootNote}`);
  }
  if (o.rootNote !== null && o.unpitched) {
    fail("--root-note and --unpitched are mutually exclusive");
  }
  if ((o.rootNote !== null || o.unpitched) && o.ingest.length === 0) {
    fail("--root-note and --unpitched apply to --ingest; a bank detects each clip's pitch");
  }
  return o;
}

// ---------------------------------------------------------------------------
// Preconditions — this script, and only this script, needs these
// ---------------------------------------------------------------------------

/** The Freesound token. Every path here fetches from Freesound, so it is required. */
function requireFreesoundKey() {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) {
    fail(
      "FREESOUND_API_KEY not set (repo-root .env). This script is the one-time ingest " +
        "step and the only one that contacts freesound.org; get a token at " +
        "https://freesound.org/apiv2/apply. No other script needs it.",
    );
  }
  return key;
}

/** ffmpeg, needed only to decode a preview when a pitch has to be detected. */
function requireFfmpeg(hint) {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    fail(
      "ffmpeg not on PATH. This one-time ingest step decodes each preview to PCM to " +
        `detect its recorded pitch. ${hint}`,
    );
  }
}

/** The write-scoped R2 config, resolved only when `--publish` was asked for. */
function requirePublishConfig() {
  try {
    return r2ConfigFromEnv("publish");
  } catch (err) {
    fail(
      `${err.message}. --publish uploads each ingested clip's original bytes to ` +
        "sources/<clip-id>; the write pair is developer-local and stays off CI.",
    );
  }
}

// ---------------------------------------------------------------------------
// Freesound (the ingest boundary)
// ---------------------------------------------------------------------------

/** Search Freesound for CC0 candidates matching a query; returns lightweight records. */
async function search(query, key, per) {
  const url =
    "https://freesound.org/apiv2/search/text/?" +
    new URLSearchParams({
      query,
      filter: 'license:"Creative Commons 0" duration:[0.3 TO 12]',
      fields: "id,name,license,duration,previews,channels,username",
      sort: "score",
      page_size: String(per),
    });
  const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
  if (!res.ok) {
    warn(`search "${query}" -> HTTP ${res.status}`);
    return [];
  }
  const j = await res.json();
  return (j.results || []).filter(
    (r) => isCC0(r.license) && r.previews?.["preview-hq-ogg"],
  );
}

/** Fetch one sound's metadata (license, previews, duration) by Freesound id. */
async function soundMetadata(id, key) {
  const url =
    `https://freesound.org/apiv2/sounds/${id}/?` +
    new URLSearchParams({ fields: "id,name,license,duration,previews" });
  const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
  if (!res.ok) {
    throw new Error(`freesound sound ${id} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Download a search candidate's preview to the cache (by id) and return its bytes. */
async function fetchPreview(rec, key) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${rec.id}.ogg`);
  if (existsSync(path)) return readFileSync(path);
  const buf = await fetchSource(rec.previews["preview-hq-ogg"], key);
  writeFileSync(path, buf);
  return buf;
}

/**
 * Fetch one source URL. The API token rides along as a `Token` header for any
 * `*.freesound.org` URL when one is set; the preview CDN needs no auth, so the seeding
 * path fetches the registry's recorded URLs with no token at all.
 */
async function fetchSource(url, key) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  const freesound =
    host === "freesound.org" || host.endsWith(".freesound.org");
  const headers = freesound && key ? { Authorization: `Token ${key}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The Freesound id a source names, or null. Recognizes a preview CDN path
 * (`/previews/338/338869_4067257-hq.ogg`), a sound page (`/s/338869/`,
 * `/people/<user>/sounds/338869/`), and a bare numeric id.
 */
function freesoundIdOf(src) {
  if (/^\d+$/.test(src.trim())) return Number(src.trim());
  const preview = src.match(/\/previews\/\d+\/(\d+)_/);
  if (preview) return Number(preview[1]);
  const page = src.match(/freesound\.org\/(?:s|(?:people\/[^/]+\/sounds))\/(\d+)/);
  if (page) return Number(page[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Pitch detection
// ---------------------------------------------------------------------------

/** Decode ogg bytes to mono Float32 at `rate` via ffmpeg (stdin → stdout). */
function decodeMono(oggBytes, rate) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { input: oggBytes, maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/**
 * Estimate the fundamental (MIDI note + confidence in [0,1]) of a monophonic sample by
 * normalized autocorrelation. Picks the shortest lag whose correlation is near the peak
 * (to avoid the classic octave-down error), with parabolic interpolation for accuracy.
 * Returns null if too quiet or unpitched-looking.
 */
function detectPitch(pcm, rate) {
  // Window: skip the attack, take up to ~400ms of the body.
  const start = Math.min(pcm.length, Math.floor(0.05 * rate));
  const len = Math.min(pcm.length - start, Math.floor(0.4 * rate));
  if (len < rate * 0.05) return null;
  const x = pcm.subarray(start, start + len);
  // RMS gate — silence has no pitch.
  let energy = 0;
  for (let i = 0; i < x.length; i++) energy += x[i] * x[i];
  if (Math.sqrt(energy / x.length) < 1e-3) return null;

  const minHz = 45,
    maxHz = 2500;
  const minLag = Math.floor(rate / maxHz);
  const maxLag = Math.min(Math.floor(rate / minHz), Math.floor(x.length / 2));
  const r = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    r[lag] = s;
  }
  let rmax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) rmax = Math.max(rmax, r[lag]);
  if (rmax <= 0) return null;
  // First strong local-max lag (>= 0.9 * peak) — the true period, not a multiple.
  let best = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] >= 0.9 * rmax && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      best = lag;
      break;
    }
  }
  if (best < 0) return null;
  // Parabolic interpolation around the peak.
  const a = r[best - 1],
    b = r[best],
    c = r[best + 1];
  const denom = a - 2 * b + c;
  const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = best + delta;
  const hz = rate / period;
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  // Confidence: peak autocorrelation normalized by zero-lag energy.
  const conf = b / energy;
  if (midi < 12 || midi > 120) return null;
  return { midi, hz, conf };
}

/** The detection an accepted clip must clear: a confident, in-range fundamental. */
const MIN_CONFIDENCE = 0.5;

/** MIDI number → note name (for logs). */
function midiName(m) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[m % 12]}${Math.floor(m / 12) - 1}`;
}

// ---------------------------------------------------------------------------
// The clip store
// ---------------------------------------------------------------------------

/**
 * Add a clip to the registry, or reuse the entry already there. A clip id is content,
 * so an entry that exists is authoritative: its license and provenance are kept as
 * they are and only a missing `root_note` is filled in. Returns
 * `{ id, entry, added, updated }`.
 */
function upsertClip(clips, { id, source_url, freesound_id, root_note }) {
  const existing = clips.get(id);
  if (existing) {
    let updated = false;
    if (existing.root_note === undefined && root_note !== undefined) {
      existing.root_note = root_note;
      updated = true;
    }
    return { id, entry: existing, added: false, updated };
  }
  const entry = { id, license: CC0_SPDX, source_url };
  if (freesound_id !== null && freesound_id !== undefined) {
    entry.freesound_id = freesound_id;
  }
  if (root_note !== undefined) entry.root_note = root_note;
  clips.set(id, entry);
  return { id, entry, added: true, updated: false };
}

/**
 * Upload one clip's original bytes to `sources/<clip-id>` and record the object in the
 * lock. An object the lock already records with this digest and size is left alone
 * unless `force` is set, so re-ingesting a clip is a no-op. Returns true when bytes
 * were uploaded.
 */
async function publishSource(id, bytes, lock, r2, force = false) {
  const key = sourceKey(id);
  const record = lock[key];
  if (!force && record && record.sha256 === id && record.bytes === bytes.length) {
    return false;
  }
  await putObject({ ...r2, key, body: bytes, contentType: "application/octet-stream" });
  lock[key] = { bucket: r2.bucket, sha256: id, bytes: bytes.length };
  return true;
}

// ---------------------------------------------------------------------------
// Single-clip ingest
// ---------------------------------------------------------------------------

/**
 * Ingest one clip named by URL or Freesound id, with no bank curation. This is the
 * back-fill path: a pack may already reference the clip while its bytes are missing
 * from the object store, in which case the registry entry is reused as it stands and
 * only the upload happens.
 */
async function runIngest(opts) {
  const key = requireFreesoundKey();
  const r2 = opts.publish && !opts.dryRun ? requirePublishConfig() : null;

  const clips = readClips();
  const lock = readObjectsLock();
  let registryDirty = false;
  let lockDirty = false;

  for (const src of opts.ingest) {
    const freesoundId = freesoundIdOf(src);
    let url = src;
    if (/^\d+$/.test(src.trim())) {
      const meta = await soundMetadata(freesoundId, key);
      url = meta.previews?.["preview-hq-ogg"];
      if (!url) fail(`freesound sound ${freesoundId} has no hq-ogg preview`);
    }

    const bytes = await fetchSource(url, key);
    const id = clipId(bytes);
    const existing = clips.get(id);

    if (!existing) {
      if (freesoundId === null) {
        fail(
          `${url} is a new clip (${id}) and names no Freesound sound, so its license ` +
            "cannot be verified. Ingest a new clip by its Freesound URL or id; only " +
            "CC0 sources are accepted.",
        );
      }
      const meta = await soundMetadata(freesoundId, key);
      if (!isCC0(meta.license)) {
        fail(
          `freesound sound ${freesoundId} is licensed ${meta.license}, not CC0. Only ` +
            "CC0 sources are ingested.",
        );
      }
    }

    // A registry entry is authoritative: its recorded pitch stands, and a clip that
    // records none needs none, so a back-fill detects nothing and needs no ffmpeg.
    const rootNote = existing
      ? (existing.root_note ?? opts.rootNote ?? undefined)
      : resolveIngestRootNote(opts, bytes, url);
    const { added, updated } = upsertClip(clips, {
      id,
      source_url: url,
      freesound_id: freesoundId,
      root_note: rootNote,
    });
    registryDirty ||= added || updated;
    const note =
      rootNote === undefined ? "" : ` root_note=${midiName(rootNote)}(${rootNote})`;
    log(`${added ? "+" : "="} ${id}${note}  ${url}`);

    if (opts.dryRun) continue;
    if (r2) {
      const uploaded = await publishSource(id, bytes, lock, r2);
      lockDirty ||= uploaded;
      log(`  ${uploaded ? "uploaded" : "already published"} ${sourceKey(id)}`);
    }
  }

  if (opts.dryRun) {
    log("\n(dry run — nothing written, nothing uploaded)");
    return;
  }
  if (registryDirty) {
    writeClips(clips);
    log(`\nwrote ${CLIPS_PATH}`);
  }
  if (lockDirty) {
    writeObjectsLock(lock);
    log(`wrote ${OBJECTS_LOCK_PATH}`);
  }
  if (!opts.publish) {
    warn(
      "no bytes uploaded — re-run with --publish to upload sources/<clip-id> and record " +
        "objects.lock.json, or a pack build will fail on the missing object",
    );
  }
}

/** The pitch to record for an ingested clip: given, skipped, or detected. */
function resolveIngestRootNote(opts, bytes, url) {
  if (opts.rootNote !== null) return opts.rootNote;
  if (opts.unpitched) return UNPITCHED_ROOT_NOTE;
  requireFfmpeg("Pass --root-note <midi> or --unpitched to skip detection.");
  let det = null;
  try {
    det = detectPitch(decodeMono(bytes, 22050), 22050);
  } catch (e) {
    fail(`${url}: ${e.message}`);
  }
  if (!det || det.conf < MIN_CONFIDENCE) {
    fail(
      `${url}: no confident pitch detected (${det ? det.conf.toFixed(2) : "no fundamental"}). ` +
        "Pass --root-note <midi> for a melodic clip, or --unpitched for percussion.",
    );
  }
  log(`  detected ${midiName(det.midi)}(${det.midi}) conf=${det.conf.toFixed(2)}`);
  return det.midi;
}

// ---------------------------------------------------------------------------
// Source seeding
// ---------------------------------------------------------------------------

/** Where a verified copy of one clip's original bytes is cached, keyed by clip id. */
function sourceCachePath(id) {
  return join(CACHE, "sources", id);
}

/** Whether the lock already records this clip's source object under its own digest. */
function sourcePublished(lock, id) {
  const record = lock[sourceKey(id)];
  return Boolean(record) && record.sha256 === id;
}

/**
 * Read one clip's original bytes, from the cache when a copy is there and still hashes
 * to the clip id, otherwise from the clip's recorded `source_url`. The bytes are
 * verified against the id either way, so a truncated download or a URL that no longer
 * serves the ingested source is caught here rather than at image-build time. Only
 * verified bytes are cached, so a re-run after a partial upload refetches nothing.
 * Returns `{ bytes, cached }`.
 */
async function loadSourceBytes(clip, key) {
  const path = sourceCachePath(clip.id);
  if (existsSync(path)) {
    const cached = readFileSync(path);
    if (clipId(cached) === clip.id) return { bytes: cached, cached: true };
  }

  const bytes = await fetchSource(clip.source_url, key);
  const id = clipId(bytes);
  if (id !== clip.id) {
    throw new Error(
      `bytes hash to ${id}, so ${clip.source_url} no longer serves the source this ` +
        "clip was ingested from",
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { bytes, cached: false };
}

/**
 * Seed `sources/<clip-id>` for every clip the registry pins. The registry is the work
 * list, so no search runs and no pack changes which clips it references; a clip the
 * lock already records is skipped, which makes the mode resumable and idempotent.
 * Without `--publish` each clip is still fetched and verified and the upload is only
 * reported, so the whole path is exercisable without credentials. A clip that fails to
 * fetch or whose bytes do not hash to its id is a hard error naming the clip and its
 * URL; the remaining clips still run and the process exits non-zero with a summary.
 */
async function runSeedSources(opts) {
  const key = process.env.FREESOUND_API_KEY ?? "";
  const upload = opts.publish && !opts.dryRun;
  const r2 = upload ? requirePublishConfig() : null;

  const clips = readClips();
  const lock = readObjectsLock();
  const all = [...clips.values()];
  const todo = opts.force
    ? all
    : all.filter((clip) => !sourcePublished(lock, clip.id));

  log(
    `${all.length} clips in ${CLIPS_PATH}: ${todo.length} to seed, ` +
      `${all.length - todo.length} already in the lock`,
  );
  if (todo.length === 0) {
    log("nothing to do");
    return;
  }
  if (!upload) {
    log("(no --publish: fetching and verifying only, uploading nothing)");
  }

  const failures = [];
  let uploaded = 0;

  for (let i = 0; i < todo.length; i++) {
    const clip = todo[i];
    const at = `[${i + 1}/${todo.length}]`;

    let loaded;
    try {
      loaded = await loadSourceBytes(clip, key);
    } catch (err) {
      failures.push({ clip, message: err.message });
      warn(`${at} ${clip.id} FAILED ${clip.source_url}: ${err.message}`);
      continue;
    }

    const size = `${loaded.bytes.length} bytes${loaded.cached ? ", cached" : ""}`;
    if (!upload) {
      log(`${at} ${clip.id} verified, would upload ${sourceKey(clip.id)} (${size})`);
      continue;
    }

    try {
      const put = await publishSource(clip.id, loaded.bytes, lock, r2, opts.force);
      if (put) {
        uploaded++;
        // Written after every upload so an interrupted seed resumes where it stopped.
        writeObjectsLock(lock);
      }
      const what = put ? "uploaded" : "already published";
      log(`${at} ${clip.id} ${what} ${sourceKey(clip.id)} (${size})`);
    } catch (err) {
      failures.push({ clip, message: err.message });
      warn(`${at} ${clip.id} FAILED uploading ${sourceKey(clip.id)}: ${err.message}`);
    }
  }

  if (uploaded > 0) log(`\nuploaded ${uploaded} of ${todo.length}, wrote ${OBJECTS_LOCK_PATH}`);
  else if (upload) log(`\nnothing uploaded; ${OBJECTS_LOCK_PATH} unchanged`);
  else {
    log(
      `\n${todo.length - failures.length} of ${todo.length} clips verified and ready ` +
        "to upload — re-run with --publish to upload them and record objects.lock.json",
    );
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} of ${todo.length} clips failed:\n`);
    for (const f of failures) {
      process.stderr.write(`  ${f.clip.id}\n    ${f.clip.source_url}\n    ${f.message}\n`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Bank curation
// ---------------------------------------------------------------------------

async function runCuration(opts) {
  const bank = BANKS[opts.bank];
  if (!bank) {
    fail(`unknown --bank "${opts.bank}" (one of: ${Object.keys(BANKS).join(", ")})`);
  }
  const outPath = opts.out ?? packPath(bank.name);
  const key = requireFreesoundKey();
  requireFfmpeg("A bank detects the pitch of every melodic clip it accepts.");
  const r2 = opts.publish && !opts.dryRun ? requirePublishConfig() : null;

  log(`curating bank ${bank.name} (${bank.spec.length} instruments)`);

  const chosen = [];
  const missed = [];
  for (const spec of bank.spec) {
    const cands = await search(spec.query, key, opts.per);
    let pick = null;
    for (const rec of cands) {
      let bytes;
      try {
        bytes = await fetchPreview(rec, key);
      } catch (e) {
        warn(`${spec.name}: ${e.message}`);
        continue;
      }
      if (spec.pitched) {
        let det;
        try {
          det = detectPitch(decodeMono(bytes, 22050), 22050);
        } catch (e) {
          warn(`${spec.name} #${rec.id}: ${e.message}`);
          continue;
        }
        if (!det || det.conf < MIN_CONFIDENCE) continue;
        if (det.midi < spec.range[0] || det.midi > spec.range[1]) continue;
        pick = { rec, bytes, root_note: det.midi, det };
        break;
      } else {
        // Percussion: prefer the shortest candidate (a single hit).
        if (rec.duration <= 2.0) {
          pick = { rec, bytes, root_note: UNPITCHED_ROOT_NOTE, det: null };
          break;
        }
      }
    }
    if (!pick) {
      missed.push(spec.name);
      warn(`no candidate for ${spec.name} (of ${cands.length})`);
      continue;
    }
    const id = clipId(pick.bytes);
    const detStr = pick.det
      ? `note=${midiName(pick.root_note)}(${pick.root_note}) conf=${pick.det.conf.toFixed(2)}`
      : "unpitched";
    log(
      `✓ ${spec.name.padEnd(16)} clip=${id.slice(0, 12)} id=${String(pick.rec.id).padEnd(8)} ${pick.rec.duration.toFixed(2)}s ${detStr}`,
    );
    chosen.push({ spec, id, ...pick });
  }

  log(
    `\n${chosen.length}/${bank.spec.length} instruments sourced${missed.length ? `; missing: ${missed.join(", ")}` : ""}`,
  );
  if (opts.dryRun) {
    log(`\n(dry run — ${bank.name}.toml not written, nothing uploaded)`);
    return;
  }
  if (chosen.length < 8) fail("too few instruments sourced to write a bank");

  // Every accepted clip enters the registry, reusing an entry that is already there.
  const clips = readClips();
  let added = 0;
  let updated = 0;
  for (const c of chosen) {
    const res = upsertClip(clips, {
      id: c.id,
      source_url: c.rec.previews["preview-hq-ogg"],
      freesound_id: c.rec.id,
      root_note: c.root_note,
    });
    if (res.added) added++;
    else if (res.updated) updated++;
  }
  writeClips(clips);
  log(`wrote ${CLIPS_PATH} (${added} new, ${updated} filled in, ${chosen.length - added - updated} reused)`);

  if (r2) {
    const lock = readObjectsLock();
    let uploads = 0;
    for (const c of chosen) {
      if (await publishSource(c.id, c.bytes, lock, r2)) uploads++;
    }
    writeObjectsLock(lock);
    log(`wrote ${OBJECTS_LOCK_PATH} (${uploads} uploaded, ${chosen.length - uploads} already published)`);
  }

  const previous = readExistingManifest(outPath);
  const version = opts.version ?? previous?.version ?? bank.version;
  writeFileSync(outPath, renderManifest(bank, chosen, version, previous));
  log(`wrote ${outPath} (${chosen.length} instruments, version ${version})`);

  if (previous && version === previous.version && manifestChanged(previous, chosen)) {
    warn(
      `${bank.name} changed but still says version ${version} — a pack is immutable, so ` +
        "bump it (--version <x.y.z>) before publishing",
    );
  }
  if (!opts.publish) {
    warn(
      "no bytes uploaded — re-run with --publish to upload each sources/<clip-id>, or a " +
        "pack build will fail on the missing objects",
    );
  }
  log(`Next: node scripts/build-sample-pack.mjs ${bank.name} --publish`);
}

// ---------------------------------------------------------------------------
// The bank manifest
// ---------------------------------------------------------------------------

/**
 * Read the manifest being replaced, leniently: its `version` and the per-entry
 * `root_note` overrides a curator should not silently drop. A manifest that does not
 * exist or does not parse is simply absent.
 */
function readExistingManifest(path) {
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = parseToml(readFileSync(path, "utf8"));
  } catch (err) {
    warn(`could not parse ${path} (${err.message}); writing a fresh manifest`);
    return null;
  }
  const entries = new Map();
  for (const row of Array.isArray(doc.entry) ? doc.entry : []) {
    if (typeof row?.name === "string") entries.set(row.name, row);
  }
  return { version: typeof doc.version === "string" ? doc.version : null, entries };
}

/** Whether the curated set differs from the manifest it replaces. */
function manifestChanged(previous, chosen) {
  if (previous.entries.size !== chosen.length) return true;
  return chosen.some((c) => previous.entries.get(c.spec.name)?.clip !== c.id);
}

/** Wrap prose into `# `-prefixed comment lines. */
function comment(text, width = 88) {
  const lines = [];
  let line = "#";
  for (const word of text.split(/\s+/)) {
    if (line === "#") line = `# ${word}`;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = `# ${word}`;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

/**
 * Render the bank manifest: a header, the pack identity, the normalization profile,
 * and one `[[entry]]` per instrument naming its clip id. A pack holds no source bytes,
 * so no entry carries a `url` or a `sha256`; the clip registry holds those. `pitched`
 * defaults to true, so only a percussion entry writes it.
 */
function renderManifest(bank, chosen, version, previous) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const head = `# Instrument bank — ${bank.name}
#
${comment(
  `${bank.blurb} for the \`music\` sequencer: one representative one-shot per instrument, ` +
    `which the renderer pitch-shifts across a track's notes. A ${bank.percussion} one-shot ` +
    "sets `pitched = false` and plays at its recorded pitch.",
)}
#
${comment(
  "Each `clip` is the sha256 of the source audio and resolves through `clips.toml`, which " +
    "holds the clip's licence, provenance and recorded pitch. `root_note` here overrides " +
    "the registry's value for this bank only.",
)}

name = "${bank.name}"
version = "${version}"
kind = "instrument-bank"

# Instrument one-shots are baked stereo at full rate; the sequencer resamples per note.
[normalize]
sample_rate = 44100
channels = 2
loudness_lufs = -20.0
true_peak_dbfs = -1.0
trim_silence = true
max_duration_ms = 5000
`;
  const blocks = chosen.map(({ spec, id }) => {
    const lines = [
      "",
      "[[entry]]",
      `clip = "${id}"`,
      `name = "${spec.name}"`,
      `tags = [${spec.tags.map((t) => `"${t}"`).join(", ")}]`,
      `description = "${esc(spec.description)}"`,
    ];
    if (!spec.pitched) lines.push("pitched = false");
    // A hand-written per-pack pitch override survives a re-curation of the same clip.
    const override = previous?.entries.get(spec.name);
    if (override?.clip === id && Number.isInteger(override.root_note)) {
      lines.push(`root_note = ${override.root_note}`);
    }
    return lines.join("\n");
  });
  return head + blocks.join("\n") + "\n";
}

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.seedSources) await runSeedSources(opts);
  else if (opts.ingest.length > 0) await runIngest(opts);
  else await runCuration(opts);
}

main().catch((e) => fail(e?.stack ?? String(e)));
