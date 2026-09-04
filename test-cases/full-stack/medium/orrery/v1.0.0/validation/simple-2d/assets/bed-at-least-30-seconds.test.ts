// assets/bed-at-least-30-seconds — the bed runs long enough not to wear out.
//
// THE RULE, from The music bed of `specs/assets.md`: the `.wav` "is what the game
// plays, for as long as `specs/ui.md` states, and it runs at least
// `MUSIC_MIN_SECONDS` (`30`) seconds." The sound bar says what the figure is
// protecting: the bed "stays welcome across a long sitting on one challenge", and
// `specs/ui.md` keeps it "looping on every frame the game runs", so a bed of a
// few bars comes round again and again while a player works on one machine.
//
// WHAT IT READS. The decoded length of `assets/audio/music.wav` in seconds,
// against `MUSIC_MIN_SECONDS` — the case's own figure, so the pair a reviewer
// reads is the `30` `specs/assets.md` fixes beside the build's own length. The
// length comes off the decode's sample frames and its rate, which is what a
// player actually hears rather than what a header claims.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a file whose length
// cannot be read is not a file running for thirty seconds. That it decodes at all
// is decided on its own by `bed-file-decodes`; here it is a precondition.
//
// THE EVIDENCE is the bed's waveform under a seconds ruler, with the thirty-second
// floor marked on it, so a reviewer sees the length beside the bar.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { MUSIC_MIN_SECONDS } from "../constants";
import { writeImageBytes } from "../media";
import { paintWaveform } from "./bed-audio";
import { readClip } from "./clips";
import { BED_FILE } from "./files";
import { showPanel } from "./readouts";

it("runs the music bed for at least MUSIC_MIN_SECONDS", () => {
  const read = readClip("music bed", BED_FILE);
  if (read.clip === null) {
    showPanel("length", `${BED_FILE} — the bed against the 30-second floor`, [
      read.reason ?? "unread",
    ]);
    fail(`a readable WAV at ${BED_FILE}`, read.reason);
  }
  writeImageBytes(
    "length",
    paintWaveform(
      `${BED_FILE} — at least ${MUSIC_MIN_SECONDS} s`,
      read.clip,
      MUSIC_MIN_SECONDS,
    ).toBuffer("image/png"),
  );

  assertGreaterThanOrEqual(
    read.clip.duration,
    MUSIC_MIN_SECONDS,
    `${BED_FILE}: its length in seconds`,
  );
});
