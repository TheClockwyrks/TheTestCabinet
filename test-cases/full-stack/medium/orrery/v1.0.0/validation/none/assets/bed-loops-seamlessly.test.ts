// assets/bed-loops-seamlessly — the bed's end runs into its start.
//
// THE RULE, from Loops of `specs/assets.md`: "The bed is authored to loop
// cleanly: the file's end runs into its start with no click, no gap, and no jump
// in level, so in every channel the last sample and the first sample differ by at
// most `LOOP_SEAM_TOLERANCE` (`0.01`) of full scale." `specs/ui.md` is what makes
// the junction audible over and over: the bed is "looping on every frame the game
// runs", so a player sitting on one challenge crosses that junction every time
// the file comes round.
//
// WHAT IT READS. In EVERY channel of the decoded file, the absolute difference
// between the last sample and the first, against `LOOP_SEAM_TOLERANCE` — the
// case's own figure, so the pair a reviewer reads is the `0.01`
// `specs/assets.md` fixes beside the build's own step. Every channel, because a
// stereo bed that joins cleanly on the left and clicks on the right is a bed that
// clicks.
//
// THE READING IS EXACTLY THE SENTENCE'S. "the last sample and the first sample" —
// so the two samples at the ends of the file, not an average of the tail against
// an average of the head, and not the largest step anywhere in the file. A bed
// that fades to nothing at both ends passes because its ends meet, which is the
// property the sentence is about.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a file whose samples
// cannot be read has no junction to read. That it decodes at all is decided on
// its own by `bed-file-decodes`; here it is a precondition.
//
// THE EVIDENCE is the junction itself: the bed's final second running into its
// first, drawn as the one continuous stretch a looping source plays, with the
// end-to-start seam marked.

import { it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { LOOP_SEAM_TOLERANCE } from "../constants";
import { writeImageBytes } from "../media";
import { paintSeam } from "./bed-audio";
import { readClip } from "./clips";
import { BED_FILE } from "./files";
import { showPanel } from "./readouts";

/** How much of each end the seam picture shows, in seconds. */
const SEAM_WINDOW = 1;

it("joins the bed's last sample to its first within LOOP_SEAM_TOLERANCE", () => {
  const read = readClip("music bed", BED_FILE);
  if (read.clip === null) {
    showPanel("seam", `${BED_FILE} — the bed's loop junction`, [
      read.reason ?? "unread",
    ]);
    fail(`a readable WAV at ${BED_FILE}`, read.reason);
  }
  writeImageBytes(
    "seam",
    paintSeam(
      `${BED_FILE} — the loop junction`,
      read.clip,
      SEAM_WINDOW,
    ).toBuffer("image/png"),
  );

  for (const [index, channel] of read.clip.channels.entries()) {
    const last = channel[read.clip.frames - 1] ?? 0;
    const first = channel[0] ?? 0;
    assertLessThanOrEqual(
      Math.abs(last - first),
      LOOP_SEAM_TOLERANCE,
      `channel ${index}: how far its last sample sits from its first, of full scale`,
    );
  }
});
