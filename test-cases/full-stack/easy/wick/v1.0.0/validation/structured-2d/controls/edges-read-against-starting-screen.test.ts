// controls/edges-read-against-starting-screen — a press that changes screens
// acts on one screen only.
//
// WHAT THIS DECIDES. One thing: with two level-ups queued, one `confirm`
// accepts ONE offer. The acceptance opens the next overlay in the same frame,
// and that overlay is a screen on which `confirm` accepts too; a build that
// re-read the frame's edge against the screen it landed in would accept
// twice, leaving `pendingLevelUps` `0` and the run back on `playing`. That
// an acceptance applies its item and draws the next offers is progression's
// business; this reads only what the one press left pending.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "All of a frame's edges are
//   read against the screen the frame began on, so a press that changes
//   screens never also acts on the screen it lands in."
//   specs/controls.md ("What each screen reads"): on `levelup`, "`confirm`
//   accepts the highlighted offer".
//   specs/progression.md ("Choosing"): "Accepting decrements
//   `pendingLevelUps`. When level-ups remain queued the next overlay opens
//   immediately, with a fresh pool drawn from the slots as the acceptance
//   left them".
//   specs/progression.md ("The draw"): "The overlay offers `OFFER_COUNT`
//   distinct candidates drawn uniformly at random from the pool without
//   replacement", with `OFFER_COUNT` 3; the pool over an empty loadout holds
//   every base weapon and every passive, so the next overlay's offers number
//   3 as well.
//
// THE DRIVE. An isolated world (every switch off, nothing held, nothing
// alive) so nothing the opening tick runs can drop, hit, or spawn;
// `pendingLevelUps` is posed to 2 and the one `playing` tick that opens the
// overlay is run, read back as `levelup` with 2 pending. The press is a REAL
// `Enter` dispatched at the engine's input seam and delivered by one frame,
// on the overlay's fresh `menuIndex` `0`. What is read is the overlay that
// frame left: still `levelup`, one level-up pending, and `OFFER_COUNT` offers
// of its own.
//
// THE TOLERANCE. None: a count, a screen name, and a list length are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

/** Level-ups queued before the press: one to accept, one to remain. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("accepts one offer for one Enter with two level-ups queued", async () => {
  isolate(h);
  const opened = await openLevelUp(h, QUEUED);
  assertEqual(opened.screen, "levelup", "the screen the press is made from");
  assertEqual(
    opened.run.pendingLevelUps,
    QUEUED,
    "the level-ups pending before the press",
  );
  assertEqual(opened.menuIndex, 0, "the highlighted offer before the press");

  const after = await tap(h, "Enter");
  captureStill(h, "once");

  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "the level-ups pending after one Enter",
  );
  assertEqual(after.screen, "levelup", "the screen after one Enter");
  assertLength(after.run.offers, OFFER_COUNT, "the next overlay's own offers");
});
