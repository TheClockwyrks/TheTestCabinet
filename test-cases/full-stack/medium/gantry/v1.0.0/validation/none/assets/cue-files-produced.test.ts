// assets/cue-files-produced — one committed, decodable, non-silent `.wav` per
// cue.
//
// specs/assets.md, "The sound": "Produce one `.wav` per cue in `specs/ui.md`,
// committed as `assets/audio/<cue>.wav`, with `sfx-synth` and `sfx-sample` as
// suits each", over the eleven-row table naming `place`, `delete`, `run-start`,
// `attach`, `placed`, `creak`, `break`, `collapse`, `complete`, `fail` and
// `motor`. specs/assets.md, "The tools": "the audio tools record voices,
// layers, or notes and render a PCM `.wav`".
//
// THE SPEC NAMES THE FILE, SO NOTHING HAS TO BE INFERRED. The committed path is
// fixed — "each cue's sound as `assets/audio/<cue>.wav`, under the cue name
// `specs/ui.md` gives it" — and "The name a file carries is what says which cue
// it is". So this point is decided off the repository as it stands rather than
// by withholding files from a served page and listening for silence: the file
// that backs a cue is the file the specification told the build to commit under
// that cue's name.
//
// WHAT IS READ, AND WHY EACH PART OF IT. A cue bound to a file that is missing,
// that is not a RIFF/WAVE container, that carries no `fmt ` or `data` chunk, or
// whose samples are all zero, is a cue the player never hears — and each of
// those is a different way of shipping nothing, so the file is opened and
// decoded rather than merely counted. The format tag is held to uncompressed
// PCM: `1` (integer PCM) or `3` (IEEE float), the two the tools' "render a PCM
// `.wav`" covers, and `0xFFFE` (extensible) resolved through its sub-format,
// which is how a multi-channel PCM file is written.
//
// NOTHING ABOUT WAVEFORM, ENVELOPE, DURATION OR LOUDNESS is read: those are the
// build's, and specs/assets.md states them as direction ("a short, dry clack")
// rather than as figures. The one bar held is that the file is not silence.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/**
 * The build workspace: this suite is staged at `<workspace>/validation/assets/`,
 * so the repository root is two directories above it. Derived from this module's
 * own URL rather than from the working directory, which the runner is free to
 * set wherever it likes.
 */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The eleven cues `specs/ui.md` names, in the order that file lists them. */
const CUES = [
  "place",
  "delete",
  "run-start",
  "attach",
  "placed",
  "creak",
  "break",
  "collapse",
  "complete",
  "fail",
  "motor",
] as const;

/** What one decoded RIFF/WAVE container carries. */
interface Wav {
  /** The `fmt ` chunk's format tag, resolved through `WAVE_FORMAT_EXTENSIBLE`. */
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  /** The `data` chunk's length in bytes. */
  dataBytes: number;
  /** The largest sample magnitude, as a fraction of full scale. */
  peak: number;
}

/** Four bytes read as ASCII, so a chunk id can be named in a failure. */
function tag(bytes: Buffer, at: number): string {
  return bytes.toString("latin1", at, at + 4);
}

/**
 * Decode a RIFF/WAVE container far enough to say whether it is a sound.
 *
 * Chunks are walked rather than assumed at fixed offsets: a renderer is free to
 * write `LIST`, `fact` or `cue ` chunks before or between `fmt ` and `data`, and
 * every chunk is padded to an even length.
 */
function decodeWav(bytes: Buffer, what: string): Wav {
  if (
    bytes.length < 12 ||
    tag(bytes, 0) !== "RIFF" ||
    tag(bytes, 8) !== "WAVE"
  ) {
    fail(
      `${what} to be a RIFF/WAVE container, which is what the audio tools ` +
        "render (specs/assets.md)",
      bytes.length < 12
        ? `${bytes.length} bytes`
        : `a "${tag(bytes, 0)}"/"${tag(bytes, 8)}" file`,
    );
  }

  let format = -1;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataAt = -1;
  let dataBytes = 0;

  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      format = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      bits = bytes.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE carries the real tag in the first two bytes of
      // its sub-format GUID.
      if (format === 0xfffe && size >= 40)
        format = bytes.readUInt16LE(body + 24);
    } else if (id === "data") {
      dataAt = body;
      dataBytes = Math.min(size, bytes.length - body);
    }
    at = body + size + (size % 2);
  }

  if (format < 0) fail(`${what} to carry a \`fmt \` chunk`, "it carries none");
  if (dataAt < 0) fail(`${what} to carry a \`data\` chunk`, "it carries none");

  // The peak, read at the sample width the header declares. Anything else is
  // left at zero, which reports as silence rather than as a pass.
  let peak = 0;
  const view = bytes;
  if (format === 1 && bits === 16) {
    for (let i = dataAt; i + 1 < dataAt + dataBytes; i += 2) {
      peak = Math.max(peak, Math.abs(view.readInt16LE(i)) / 32768);
    }
  } else if (format === 1 && bits === 8) {
    for (let i = dataAt; i < dataAt + dataBytes; i += 1) {
      peak = Math.max(peak, Math.abs(view.readUInt8(i) - 128) / 128);
    }
  } else if (format === 1 && bits === 24) {
    for (let i = dataAt; i + 2 < dataAt + dataBytes; i += 3) {
      const raw = view.readUIntLE(i, 3);
      const signed = raw >= 0x800000 ? raw - 0x1000000 : raw;
      peak = Math.max(peak, Math.abs(signed) / 8388608);
    }
  } else if (format === 1 && bits === 32) {
    for (let i = dataAt; i + 3 < dataAt + dataBytes; i += 4) {
      peak = Math.max(peak, Math.abs(view.readInt32LE(i)) / 2147483648);
    }
  } else if (format === 3 && bits === 32) {
    for (let i = dataAt; i + 3 < dataAt + dataBytes; i += 4) {
      peak = Math.max(peak, Math.abs(view.readFloatLE(i)));
    }
  } else if (format === 3 && bits === 64) {
    for (let i = dataAt; i + 7 < dataAt + dataBytes; i += 8) {
      peak = Math.max(peak, Math.abs(view.readDoubleLE(i)));
    }
  }

  return { format, channels, sampleRate, bits, dataBytes, peak };
}

/** Below this a file is silence rather than a sound: half a bit of 16-bit PCM. */
const SILENCE = 1 / 65536;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits a decodable, non-silent .wav for each of the eleven cues", async () => {
  const report: string[] = [];

  await h.capture("cues", "The eleven committed cue files");

  for (const cue of CUES) {
    const path = join(WORKSPACE, "assets", "audio", `${cue}.wav`);
    assertTrue(
      existsSync(path),
      `the \`${cue}\` cue's produced sound committed at ` +
        `\`assets/audio/${cue}.wav\` (specs/assets.md)`,
    );

    const wav = decodeWav(readFileSync(path), `assets/audio/${cue}.wav`);
    assertTrue(
      wav.format === 1 || wav.format === 3,
      `\`assets/audio/${cue}.wav\` to be uncompressed PCM, which is what the ` +
        "audio tools render (specs/assets.md) — format tag 1 (integer) or 3 " +
        `(float), not ${wav.format}`,
    );
    assertTrue(
      wav.dataBytes > 0,
      `\`assets/audio/${cue}.wav\` to carry audio in its \`data\` chunk`,
    );
    assertTrue(
      wav.peak > SILENCE,
      `\`assets/audio/${cue}.wav\` to carry a sample above silence, so the ` +
        `\`${cue}\` cue is not bound to an empty file (specs/assets.md) — its ` +
        `peak is ${wav.peak.toFixed(6)} of full scale`,
    );

    report.push(
      `${cue}: ${wav.channels}ch ${wav.sampleRate}Hz ${wav.bits}-bit ` +
        `format ${wav.format}, ${wav.dataBytes} bytes, peak ` +
        `${wav.peak.toFixed(4)}`,
    );
  }

  assertEqual(report.length, CUES.length, "the cues read off disk");
  console.log(`gantry: the committed cue files —\n  ${report.join("\n  ")}`);
});
