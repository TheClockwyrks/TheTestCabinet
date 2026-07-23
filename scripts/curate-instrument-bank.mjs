// Curate a CC0 instrument bank for the `music` tool from Freesound.
//
// The `music` sequencer plays a bank instrument by pitch-shifting one recorded note
// across a track's notes (see `crates/audio-core/src/music.rs`). Each entry therefore
// needs the MIDI note it was recorded at (`root_note`) — and, crucially, that note can
// be ANY pitch as long as it is recorded accurately, because the engine transposes
// relative to it. So this script does not need samples tuned to a fixed pitch: for
// each desired instrument it searches Freesound (CC0 only), downloads the candidate's
// hq-ogg preview, DETECTS the fundamental pitch by autocorrelation, and records that
// as `root_note`. Percussion is marked `pitched = false` (played native, never
// transposed) and skips pitch detection.
//
// The output is `containers/sample-packs/gm-lite.toml` with real `url` + `sha256`
// (the preview's content hash, which `build-sample-pack.mjs` re-verifies) + detected
// `root_note` + `pitched`. Publish it the usual way afterwards:
//   node scripts/build-sample-pack.mjs gm-lite --publish
//
// Needs `FREESOUND_API_KEY` (repo-root `.env`) and `ffmpeg` on PATH (to decode the
// ogg preview to PCM for pitch detection). Freesound search is token-tier; the preview
// CDN needs no auth.
//
// Usage:
//   node scripts/curate-instrument-bank.mjs               # curate + write gm-lite.toml
//   node scripts/curate-instrument-bank.mjs --bank cinematic  # curate a different bank (see BANKS)
//   node scripts/curate-instrument-bank.mjs --dry-run     # search + detect, print a table, no write
//   node scripts/curate-instrument-bank.mjs --per 10      # candidates to consider per instrument
//   node scripts/curate-instrument-bank.mjs --out <path>  # output manifest (default <bank>.toml)

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./lib/env.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_DIR = join(repoRoot, "containers", "sample-packs");
const CACHE = join(repoRoot, "dist", "sample-packs", ".curate-cache");

const CC0 = "http://creativecommons.org/publicdomain/zero/1.0/";

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

// The bank registry. Each bank names its output manifest (`<name>.toml`), its starting
// `version`, a one-line `blurb` for the manifest header, and its instrument `spec`.
// gm-lite keeps its original identity so re-curating it is a no-op in shape.
const BANKS = {
  "gm-lite": {
    name: "gm-lite",
    version: "0.1.0",
    blurb: "A general-MIDI-flavoured instrument bank",
    spec: GM_LITE_SPEC,
  },
  cinematic: {
    name: "cinematic",
    version: "0.1.0",
    blurb: "An epic-orchestral instrument bank (strings, brass, choir, orchestral percussion)",
    spec: CINEMATIC_SPEC,
  },
  synthwave: {
    name: "synthwave",
    version: "0.1.0",
    blurb: "A synthwave / electronic instrument bank (analog synths, pads, drum machine)",
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

function parseArgs(argv) {
  const o = { dryRun: false, per: 8, out: null, bank: "gm-lite" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--per") o.per = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--bank") o.bank = argv[++i];
    else if (a === "--help" || a === "-h") {
      log(
        `usage: node scripts/curate-instrument-bank.mjs [--bank <${Object.keys(BANKS).join("|")}>] [--dry-run] [--per N] [--out path]`,
      );
      process.exit(0);
    } else fail(`unknown arg ${a}`);
  }
  return o;
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

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
    (r) => r.license === CC0 && r.previews?.["preview-hq-ogg"],
  );
}

/** Download a preview to the cache (by id) and return its bytes. */
async function fetchPreview(rec) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${rec.id}.ogg`);
  if (existsSync(path)) return readFileSync(path);
  const res = await fetch(rec.previews["preview-hq-ogg"]);
  if (!res.ok) throw new Error(`preview ${rec.id} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

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

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));
  const bank = BANKS[opts.bank];
  if (!bank) {
    fail(`unknown --bank "${opts.bank}" (one of: ${Object.keys(BANKS).join(", ")})`);
  }
  const outPath = opts.out ?? join(PACKS_DIR, `${bank.name}.toml`);
  const key = process.env.FREESOUND_API_KEY;
  if (!key) fail("FREESOUND_API_KEY not set (repo-root .env)");
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    fail("ffmpeg not on PATH (needed to decode previews for pitch detection)");
  }
  log(`curating bank ${bank.name}@${bank.version} (${bank.spec.length} instruments)`);

  const chosen = [];
  const missed = [];
  for (const spec of bank.spec) {
    const cands = await search(spec.query, key, opts.per);
    let pick = null;
    for (const rec of cands) {
      let bytes;
      try {
        bytes = await fetchPreview(rec);
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
        if (!det || det.conf < 0.5) continue;
        if (det.midi < spec.range[0] || det.midi > spec.range[1]) continue;
        pick = { rec, bytes, root_note: det.midi, det };
        break;
      } else {
        // Percussion: prefer the shortest candidate (a single hit).
        if (rec.duration <= 2.0) {
          pick = { rec, bytes, root_note: 60, det: null };
          break;
        }
      }
    }
    if (!pick) {
      missed.push(spec.name);
      warn(`no candidate for ${spec.name} (of ${cands.length})`);
      continue;
    }
    const detStr = pick.det
      ? `note=${midiName(pick.root_note)}(${pick.root_note}) conf=${pick.det.conf.toFixed(2)}`
      : "unpitched";
    log(
      `✓ ${spec.name.padEnd(16)} id=${String(pick.rec.id).padEnd(8)} ${pick.rec.duration.toFixed(2)}s ${detStr}`,
    );
    chosen.push({ spec, ...pick });
  }

  log(
    `\n${chosen.length}/${bank.spec.length} instruments sourced${missed.length ? `; missing: ${missed.join(", ")}` : ""}`,
  );
  if (opts.dryRun) {
    log(`\n(dry run — ${bank.name}.toml not written)`);
    return;
  }
  if (chosen.length < 8) fail("too few instruments sourced to write a bank");

  writeFileSync(outPath, renderManifest(bank, chosen));
  log(`\nwrote ${outPath} (${chosen.length} instruments)`);
  log(`Next: node scripts/build-sample-pack.mjs ${bank.name} --publish`);
}

/** MIDI number → note name (for logs). */
function midiName(m) {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[m % 12]}${Math.floor(m / 12) - 1}`;
}

/** Render the full <bank>.toml from the chosen candidates. */
function renderManifest(bank, chosen) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const head = `# Instrument bank — ${bank.name}
#
# ${bank.blurb} for the \`music\` sequencer: one representative
# CC0 one-shot per instrument, which the renderer pitch-shifts across a track's notes
# (a percussion one-shot, \`pitched = false\`, plays at its native pitch). The audio is NOT
# committed here — this manifest lists each source's Freesound preview \`url\` + content
# \`sha256\`; the pack is built + published with:
#
#   node scripts/build-sample-pack.mjs ${bank.name} --publish
#
# Sourced from Freesound (CC0 only) by \`scripts/curate-instrument-bank.mjs\`, which
# detects each melodic sample's recorded pitch (\`root_note\`, a MIDI number) so the
# sequencer transposes it correctly. Re-run that script to refresh or extend the bank
# (any content change is a new \`version\`).

name = "${bank.name}"
version = "${bank.version}"
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
  const blocks = chosen.map(({ spec, rec, root_note }) => {
    const lines = [
      "",
      "[[instrument]]",
      `name = "${spec.name}"`,
      `tags = [${spec.tags.map((t) => `"${t}"`).join(", ")}]`,
      `description = "${esc(spec.description)}"`,
      `license = "CC0-1.0"`,
      `url = "${rec.previews["preview-hq-ogg"]}"`,
      `sha256 = "${sha256(readFileSync(join(CACHE, `${rec.id}.ogg`)))}"`,
      `root_note = ${root_note}`,
      `pitched = ${spec.pitched}`,
      `freesound_id = ${rec.id}`,
    ];
    return lines.join("\n");
  });
  return head + blocks.join("\n") + "\n";
}

main().catch((e) => fail(e?.stack ?? String(e)));
