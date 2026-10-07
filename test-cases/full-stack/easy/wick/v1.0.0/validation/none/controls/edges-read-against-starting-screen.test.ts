// controls/edges-read-against-starting-screen — a press that changes screens
// acts on one screen only.
//
// WHAT THIS DECIDES. One thing: a frame's edges are read against the screen the
// frame BEGAN on, so a press that leaves one screen never also acts on the one
// it lands in. Two level-ups are queued, and one `confirm` on the first overlay
// accepts one offer and leaves the second overlay standing with its own offers,
// rather than accepting from it too.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "All of a frame's edges are read
//   against the screen the frame began on, so a press that changes screens
//   never also acts on the screen it lands in."
//   specs/controls.md ("What each screen reads"): on `levelup`, "`confirm`
//   accepts the highlighted offer".
//   specs/progression.md ("Choosing"): "Accepting decrements `pendingLevelUps`.
//   When level-ups remain queued the next overlay opens immediately, with a
//   fresh pool drawn from the slots as the acceptance left them".
//   specs/progression.md ("The level-up overlay"): "A `playing` tick that ends
//   with `pendingLevelUps` above `0` runs to completion and then opens the
//   overlay".
//
// THE DRIVE. An isolated night — nothing alive, nothing held, every driver
// switch off — so the tick that opens the overlay is the only thing that runs
// before the press, and the pool is the full roster whichever offer the press
// accepts. `openLevelUp(h, 2)` poses two queued level-ups and runs the tick that
// opens the first overlay, read back as the precondition. Then ONE real `Enter`
// across one frame. A build reading the frame's edges against the screen it
// landed on would accept from the second overlay as well and stand on `playing`
// with nothing queued; a conformant one stands on the second overlay with one
// still queued and offers to show.
//
// THE TOLERANCE. None: a screen, a count, and a length are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  pressConfirm,
  type Harness,
} from "../harness";

/** The level-ups queued: two, so a press has a second overlay to land in. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts one offer for one Enter press with a second overlay queued", async () => {
  await isolate(h);
  const opened = await openLevelUp(h, QUEUED);
  assertEqual(opened.screen, "levelup", "the screen the press is made from");
  assertEqual(
    opened.run.pendingLevelUps,
    QUEUED,
    "the level-ups queued before the press",
  );
  assertGreaterThanOrEqual(
    (opened.run.offers ?? []).length,
    1,
    "the first overlay's offers before the press",
  );

  const after = await pressConfirm(h);
  await captureStill(h, "once");

  assertEqual(after.screen, "levelup", "the screen after one Enter press");
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "the level-ups still queued after one Enter press",
  );
  assertGreaterThanOrEqual(
    (after.run.offers ?? []).length,
    1,
    "the second overlay's offers after one Enter press",
  );
});
