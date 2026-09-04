// assets/music-bed-file-produced — the music bed is a committed, decodable,
// non-silent produced file.
//
// specs/assets.md, "The sound": "Produce the music bed with `music`: a steady,
// unhurried machine-yard piece under the title and select screens, committed as
// `assets/audio/music.wav` with the `.mid` it emits beside it as
// `assets/audio/music.mid`."
//
// THE SPEC NAMES THE FILE, SO NOTHING HAS TO BE INFERRED. The bed's committed
// path is fixed, and "The name a file carries is what says which subject or
// which cue it is" — so this point is decided off the repository as it stands
// rather than by withholding files from a served page one at a time and reading
// which withholding silences the title screen.
//
// ONE REQUIREMENT: that the bed exists as a produced file. Whether the title and
// select screens actually PLAY it is `audio/music-bed-on-title` and
// `audio/music-bed-on-select`, and whether the `.mid` sits beside it is
// `assets/music-mid-beside-the-wav`; a build missing the file fails all of them,
// and a build that has the file but never plays it fails only those.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where `specs/assets.md` says the bed is committed. */
const MUSIC = join("assets", "audio", "music.wav");

/** Below this a file is silence rather than music: half a bit of 16-bit PCM. */
const SILENCE = 1 / 65536;

/** Four bytes read as ASCII, so a chunk id can be named in a failure. */
function tag(bytes: Buffer, at: number): string {
  return bytes.toString("latin1", at, at + 4);
}

/** What the decode below reports. */
interface Wav {
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  dataBytes: number;
  peak: number;
}

/**
 * Decode a RIFF/WAVE container far enough to say whether it is music.
 *
 * The chunks are walked rather than assumed at fixed offsets: a renderer is free
 * to write `LIST` or `fact` chunks around `fmt ` and `data`, and every chunk is
 * padded to an even length. `WAVE_FORMAT_EXTENSIBLE` carries its real format tag
 * in the first two bytes of its sub-format GUID.
 */
function decodeWav(bytes: Buffer, what: string): Wav {
  if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") {
    fail(
      `${what} to be a RIFF/WAVE container, which is what \`music\` renders ` +
        "(specs/assets.md)",
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
      if (format === 0xfffe && size >= 40) format = bytes.readUInt16LE(body + 24);
    } else if (id === "data") {
      dataAt = body;
      dataBytes = Math.min(size, bytes.length - body);
    }
    at = body + size + (size % 2);
  }

  if (format < 0) fail(`${what} to carry a \`fmt \` chunk`, "it carries none");
  if (dataAt < 0) fail(`${what} to carry a \`data\` chunk`, "it carries none");

  let peak = 0;
  if (format === 1 && bits === 16) {
    for (let i = dataAt; i + 1 < dataAt + dataBytes; i += 2) {
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)) / 32768);
    }
  } else if (format === 1 && bits === 8) {
    for (let i = dataAt; i < dataAt + dataBytes; i += 1) {
      peak = Math.max(peak, Math.abs(bytes.readUInt8(i) - 128) / 128);
    }
  } else if (format === 1 && bits === 24) {
    for (let i = dataAt; i + 2 < dataAt + dataBytes; i += 3) {
      const raw = bytes.readUIntLE(i, 3);
      const signed = raw >= 0x800000 ? raw - 0x1000000 : raw;
      peak = Math.max(peak, Math.abs(signed) / 8388608);
    }
  } else if (format === 1 && bits === 32) {
    for (let i = dataAt; i + 3 < dataAt + dataBytes; i += 4) {
      peak = Math.max(peak, Math.abs(bytes.readInt32LE(i)) / 2147483648);
    }
  } else if (format === 3 && bits === 32) {
    for (let i = dataAt; i + 3 < dataAt + dataBytes; i += 4) {
      peak = Math.max(peak, Math.abs(bytes.readFloatLE(i)));
    }
  } else if (format === 3 && bits === 64) {
    for (let i = dataAt; i + 7 < dataAt + dataBytes; i += 8) {
      peak = Math.max(peak, Math.abs(bytes.readDoubleLE(i)));
    }
  }

  return { format, channels, sampleRate, bits, dataBytes, peak };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits the music bed as a decodable, non-silent .wav", async () => {
  const path = join(WORKSPACE, MUSIC);
  await h.capture("music", "The committed music bed");

  assertTrue(
    existsSync(path),
    `the music bed committed at \`${MUSIC}\` (specs/assets.md)`,
  );

  const wav = decodeWav(readFileSync(path), MUSIC);
  assertTrue(
    wav.format === 1 || wav.format === 3,
    `\`${MUSIC}\` to be uncompressed PCM, which is what \`music\` renders ` +
      `(specs/assets.md) — format tag 1 (integer) or 3 (float), not ` +
      `${wav.format}`,
  );
  assertTrue(wav.dataBytes > 0, `\`${MUSIC}\` to carry audio in its \`data\` chunk`);
  assertTrue(
    wav.peak > SILENCE,
    `\`${MUSIC}\` to carry a sample above silence, so the title and select ` +
      "screens are not bound to an empty file (specs/assets.md) — its peak " +
      `is ${wav.peak.toFixed(6)} of full scale`,
  );

  console.log(
    `gantry: the committed music bed — ${MUSIC}: ${wav.channels}ch ` +
      `${wav.sampleRate}Hz ${wav.bits}-bit format ${wav.format}, ` +
      `${wav.dataBytes} bytes, peak ${wav.peak.toFixed(4)}`,
  );
});
