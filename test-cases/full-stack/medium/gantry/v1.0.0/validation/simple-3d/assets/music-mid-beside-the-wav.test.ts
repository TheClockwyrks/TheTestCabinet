// assets/music-mid-beside-the-wav — the portable `.mid` is committed beside the
// bed it was rendered from.
//
// specs/assets.md, "The sound": the music bed is "committed as
// `assets/audio/music.wav` with the `.mid` it emits beside it as
// `assets/audio/music.mid`"; and, of the tools, "`music` emits a portable `.mid`
// beside the `.wav` you play."
//
// THE SPEC NAMES BOTH FILES, so the bed does not have to be identified by
// withholding files from a served page: the `.wav` is `assets/audio/music.wav`
// and the `.mid` sits beside it. What is read here is the `.mid` alone — the
// `.wav` is `assets/music-bed-file-produced`'s point, and this one fails only
// when the portable file is missing or is not a standard MIDI file.
//
// WHAT "PARSES AS A STANDARD MIDI FILE" IS. An SMF opens with an `MThd` chunk
// whose six-byte body gives the format, the number of tracks, and the division,
// and carries that many `MTrk` chunks after it. The header's own track count and
// the chunks actually present are both read, because a header claiming tracks
// that are not there is a file no sequencer opens. Nothing about tempo, key,
// instrument or note content is read: what `music` sequenced is the build's.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The directory `specs/assets.md` commits the bed and its `.mid` in. */
const AUDIO_DIR = join("assets", "audio");

/** Four bytes read as ASCII, so a chunk id can be named in a failure. */
function tag(bytes: Buffer, at: number): string {
  return bytes.toString("latin1", at, at + 4);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits a parsable .mid in the directory holding the music bed", async () => {
  const directory = join(WORKSPACE, AUDIO_DIR);
  assertTrue(
    existsSync(join(directory, "music.wav")),
    `the music bed committed at \`${AUDIO_DIR}/music.wav\`, which is the ` +
      "directory this point asks for its `.mid` in (specs/assets.md)",
  );

  const beside = existsSync(directory)
    ? readdirSync(directory).filter((name) => /\.midi?$/i.test(name))
    : [];
  const path = join(directory, "music.mid");
  assertTrue(
    existsSync(path),
    `the music bed's portable \`.mid\` committed beside its \`.wav\` as ` +
      `\`${AUDIO_DIR}/music.mid\` (specs/assets.md) — the \`.mid\` files in ` +
      `that directory are [${beside.join(", ")}]`,
  );

  const bytes = readFileSync(path);
  if (bytes.length < 14 || tag(bytes, 0) !== "MThd") {
    fail(
      `\`${AUDIO_DIR}/music.mid\` to open with the \`MThd\` header of a ` +
        "standard MIDI file, which is what `music` emits (specs/assets.md)",
      bytes.length < 14
        ? `${bytes.length} bytes`
        : `a file opening "${tag(bytes, 0)}"`,
    );
  }

  const headerBytes = bytes.readUInt32BE(4);
  if (headerBytes < 6) {
    fail(
      `\`${AUDIO_DIR}/music.mid\`'s \`MThd\` chunk to carry the six-byte ` +
        "header of a standard MIDI file",
      `${headerBytes} bytes`,
    );
  }
  const format = bytes.readUInt16BE(8);
  const declared = bytes.readUInt16BE(10);
  const division = bytes.readUInt16BE(12);

  // The chunks after the header, walked by their declared lengths, so a track
  // count is what the file really carries rather than what it claims.
  let tracks = 0;
  let at = 8 + headerBytes;
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at);
    const size = bytes.readUInt32BE(at + 4);
    if (id === "MTrk") tracks += 1;
    at += 8 + size;
  }

  await h.capture("mid", "The committed .mid beside the music bed");

  assertGreaterThanOrEqual(
    declared,
    1,
    `the tracks \`${AUDIO_DIR}/music.mid\`'s header declares, so the emitted ` +
      "`.mid` carries the piece rather than an empty header (specs/assets.md)",
  );
  assertGreaterThanOrEqual(
    tracks,
    1,
    `the \`MTrk\` chunks \`${AUDIO_DIR}/music.mid\` carries (its header ` +
      `declares ${declared})`,
  );

  console.log(
    `gantry: the committed .mid beside the music bed — ` +
      `${AUDIO_DIR}/music.mid: format ${format}, ${tracks} MTrk chunk(s), ` +
      `division ${division}, ${bytes.length} bytes`,
  );
});
