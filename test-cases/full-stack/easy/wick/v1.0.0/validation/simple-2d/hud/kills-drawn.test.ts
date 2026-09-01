// hud/kills-drawn — the kill count is drawn.
//
// WHERE THE FIGURES COME FROM. specs/ui.md ("`playing`", the HUD table):
// "Kills | The kill count." The two poses are kills 0, the count a fresh run
// carries, and kills 143, a count no other readout on the frame holds.
//
// THE WORLD. Two isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, no weapon and no passive
// held, every driver switch off. Nothing can die, so the posed count is the
// count the frame draws, and the two frames are otherwise the same empty night
// drawn on the same tick.
//
// WHAT IS READ. The runs of text one frame drew that the other did not, as a
// multiset difference. The clock, the health numbers, and the level label read
// the same in both frames and cancel, which is what lets the count 0 be read at
// all: `0:00` on the clock holds a `0` of its own, and only the difference
// between the two frames says whether the count itself was drawn. Each
// direction is read: 143 must appear where the kills are 143 and 0 where they
// are 0, so a build that draws the count only once it is non-zero fails.
//
// TOLERANCE. None: both counts are whole numbers, and a run of text either
// holds one as a whole number or does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  createHarness,
  drawnText,
  hasToken,
  isolate,
  minusLines,
  type Harness,
} from "../harness";
import { captureFrames, keepFrame } from "./hud";

/** The count a fresh run carries. */
const NONE = 0;

/** The count posed, held by no other readout on the frame. */
const MANY = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 0 at kills 0 and 143 at kills 143", async () => {
  isolate(h);
  h.debug.setKills(NONE);
  const none = await h.frameDraw();
  const noneFrame = keepFrame(h);
  const noneTick = h.snapshot().run;

  isolate(h);
  h.debug.setKills(MANY);
  const many = await h.frameDraw();
  const manyFrame = keepFrame(h);
  const manyTick = h.snapshot().run;
  captureFrames([noneFrame, manyFrame], "kills");

  assertEqual(noneTick.kills, NONE, "the count the first frame drew at");
  assertEqual(manyTick.kills, MANY, "the count the second frame drew at");

  const drewMany = minusLines(drawnText(many.calls), drawnText(none.calls));
  if (!hasToken(drewMany, String(MANY))) {
    fail(
      `a run of text holding ${MANY} that the frame at kills ${NONE} did not draw`,
      drewMany,
    );
  }
  const drewNone = minusLines(drawnText(none.calls), drawnText(many.calls));
  if (!hasToken(drewNone, String(NONE))) {
    fail(
      `a run of text holding ${NONE} that the frame at kills ${MANY} did not draw`,
      drewNone,
    );
  }
});
