// assets/bed-score-committed — the bed ships with the score it was sequenced from.
//
// THE RULE, from The music bed of `specs/assets.md`: "Produce the `music` cue with
// `music` ... `assets/audio/music.wav`, with its `assets/audio/music.mid`
// committed beside it." The tools table says what the two files are to each other:
// `music` "Produces ... sequenced music over a baked instrument bank, a `.wav`
// and a `.mid`", so the score is the sequence the bed was rendered from and the
// pair is what the tool emitted. Where the files land roots the path: "Every
// produced file sits under `assets/` at the root of this repository, at the path
// named below, and is committed."
//
// WHY BOTH. The `.wav` is what the game plays and the `.mid` is what the bed was
// made of: a score committed beside it is what lets the bed be re-voiced, re-
// rendered or read as music later, and it is the evidence that the bed was
// SEQUENCED rather than dropped in whole.
//
// WHAT IT READS. That a file sits at `MUSIC_SCORE_PATH`, and that it is a MIDI
// file rather than a name: a Standard MIDI File opens with an `MThd` header chunk
// declaring its format, its track count and its division, and carries at least
// one `MTrk` track chunk after it. Nothing about what the score PLAYS is read —
// its notes, its tempo and its instruments are the music, which is the reviewer's
// to hear in the `.wav` beside it.
//
// THE EVIDENCE is what was read of the score and of the bed beside it — the
// header the score declares, its track count and its length — set down as a
// panel, since a MIDI file is not a picture of anything.

import { it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { BED_FILE, SCORE_FILE } from "./files";
import { showPanel } from "./readouts";
import { soundBytes } from "./sounds";

/** The four bytes a Standard MIDI File opens with. */
const HEADER_CHUNK = "MThd";

/** The four bytes each of its track chunks opens with. */
const TRACK_CHUNK = "MTrk";

/** The length an `MThd` chunk declares for itself: format, tracks, division. */
const HEADER_BYTES = 6;

it("commits assets/audio/music.mid beside the bed", () => {
  // `soundBytes` is the reader for a produced sound's file; the score is one of
  // them, and what is wanted here is its bytes rather than a decode of samples it
  // does not carry.
  const score = soundBytes(SCORE_FILE);
  const bed = soundBytes(BED_FILE);
  const opening = score === null ? "" : score.toString("latin1", 0, 4);
  const tracks =
    score === null
      ? 0
      : [...score.toString("latin1").matchAll(new RegExp(TRACK_CHUNK, "g"))]
          .length;

  showPanel("score", "The committed score beside the bed", [
    score === null
      ? `${SCORE_FILE} — absent`
      : `${SCORE_FILE} — ${score.length} bytes, opens "${opening}", ` +
        `${tracks} ${TRACK_CHUNK} chunk(s)`,
    bed === null ? `${BED_FILE} — absent` : `${BED_FILE} — ${bed.length} bytes`,
  ]);

  assertNotNull(score, `the committed score at ${SCORE_FILE}`);
  assertGreaterThan(
    score?.length ?? 0,
    HEADER_BYTES + 8,
    `${SCORE_FILE}: its length in bytes, which is at least an MThd chunk`,
  );
  assertEqual(
    opening,
    HEADER_CHUNK,
    `${SCORE_FILE}: the four bytes it opens with, which a Standard MIDI File spends on its header chunk`,
  );
  assertGreaterThanOrEqual(
    tracks,
    1,
    `${SCORE_FILE}: the ${TRACK_CHUNK} track chunks it carries`,
  );
});
