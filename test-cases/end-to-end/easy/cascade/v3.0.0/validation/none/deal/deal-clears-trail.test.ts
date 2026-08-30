// Cascade — deal/deal-clears-trail: a new deal clears the painted table.
//
// specs/deal.md, The deal: "A new deal also clears the painted table, so a deal
// following a victory cascade leaves clean felt behind it." specs/victory.md
// states the other side of the same rule: the painted layer "is never cleared
// while the cascade runs" and "is cleared by a new deal ... and by nothing else."
// So the layer survives fifty-two cards' worth of flight and is wiped by exactly
// one event, and this check is that event.
//
// THE READING IS `trailStamps`, NOT PIXELS. specs/instrumentation.md reports the
// stamps the painted layer has taken since it was last cleared, and a deal that
// clears the layer sets it back to zero. That keeps this point about the CLEARING:
// a build that paints correctly and never clears fails here, and a build whose
// gate is right but whose blit is broken fails cascade/trail-persists and nothing
// here. The still is what shows the felt the deal left.
//
// HOW THE SCENARIO IS REACHED. `openTable` clears all thirteen piles, and
// `startCascade` then wins the game through the game's own path — fifty-one cards
// home, the last King moved onto its foundation by a real `move()` — so the
// cascade running is the real one, launched by the real win. It is advanced only
// until the layer has taken its first stamp, because the requirement is that a
// deal clears a painted layer and not how much of it was painted.
//
// WHY THE TWO GATES ARE SHUT BEFORE THE DEAL. `deal()` empties the piles and
// clears the layer, and specs/instrumentation.md is explicit that it "changes no
// other field": the cards already in flight keep flying, and a flying card stamps
// the layer on every frame (specs/victory.md). So a frame run after the deal would
// paint the freshly cleared layer again, and the reading would be a race rather
// than a rule. `setLaunching(false)` and `clearFlyers()` are the two operations
// that hold exactly those faculties still and nothing else, so what is read after
// the deal is what the deal left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How long the cascade is given to lay its first stamp.
 *
 * specs/victory.md holds the launch clock at `LAUNCH_INTERVAL` (`0.18`) when the
 * cascade begins, so the first card launches on the cascade's first frame and
 * stamps the layer on the next one. Half a second is nearly three launch
 * intervals: generous against any conformant build, and it bounds what a build
 * that never paints costs.
 */
const PAINT_FRAMES = framesFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("clears the painted layer a cascade left behind", async () => {
  await openTable(h);
  await startCascade(h);

  const painting = await h.until((state) => state.trailStamps > 0, {
    maxFrames: PAINT_FRAMES,
  });
  if (!painting.hit) {
    fail(
      "the running cascade to stamp the painted layer, so the deal has a painted table to clear (specs/victory.md)",
      `trailStamps was still ${painting.snapshot.trailStamps} after ${painting.frames} frames of cascade`,
    );
  }

  // Nothing may paint after the deal, or the reading would be a race between the
  // clearing and the next frame's stamps rather than the rule itself.
  await h.debug.setLaunching(false);
  await h.debug.clearFlyers();
  const before = await h.snapshot();
  assertGreaterThan(
    before.trailStamps,
    0,
    "stamps on the painted layer going into the deal (specs/victory.md)",
  );

  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const after = await h.snapshot();
  assertEqual(
    after.trailStamps,
    0,
    `stamps on the painted layer after a deal cleared the ${before.trailStamps} the cascade had laid (specs/deal.md)`,
  );
});
