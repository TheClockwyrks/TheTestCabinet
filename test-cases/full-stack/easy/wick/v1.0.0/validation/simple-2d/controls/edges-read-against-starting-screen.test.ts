// controls/edges-read-against-starting-screen — a press that changes screens
// acts on one screen only.
//
// WHAT THIS DECIDES. One thing: a frame's edges are read against the screen
// the frame BEGAN on, so a `confirm` that accepts an offer and opens the next
// queued overlay does not also accept on the overlay it opened. That
// `confirm` accepts an offer at all is screens/levelup-confirm-accepts, and
// that a queued level-up opens the next overlay is progression's; this point
// is the ONE press, ONE acceptance rule across the change of screen.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "All of a frame's edges are
//   read against the screen the frame began on, so a press that changes
//   screens never also acts on the screen it lands in."
//   specs/controls.md ("What each screen reads"): on `levelup`, "`confirm`
//   accepts the highlighted offer".
//   specs/progression.md ("Choosing"): "Accepting decrements
//   `pendingLevelUps`. When level-ups remain queued the next overlay opens
//   immediately, with a fresh pool drawn from the slots as the acceptance left
//   them", and ("The draw") "The overlay offers `OFFER_COUNT` distinct
//   candidates drawn uniformly at random from the pool", so a pool of at
//   least three candidates fills `offers` with exactly `OFFER_COUNT`.
//   specs/ui.md (`levelup`): "Then, if another level-up is queued, the next
//   overlay opens with a fresh set of offers and `menuIndex = 0`".
//
// THE DRIVE. An isolated run (`isolate`: the empty night, every driver switch
// off, no weapon held) with two level-ups queued through
// `setPendingLevelUps(2)` and the overlay opened by the real path, the
// `playing` tick that ends with the queue above `0` (`openLevelUp`). The
// screen, the queue, and the offers are read back before the press. With
// nothing held the first pool is the ten base weapons and the ten passives,
// and accepting one leaves nineteen candidates, so the second overlay's pool
// is far above `OFFER_COUNT` and its `offers` must hold exactly three. One
// REAL `Enter` is then dispatched for one frame. A build that read the edge
// again on the overlay it opened accepts twice: `pendingLevelUps` `0`,
// `screen` `playing`, and no offers at all. What the press leaves is read as
// three facts of the same event: the screen still `levelup`, the queue at
// `1`, and the fresh overlay's own `OFFER_COUNT` offers.
//
// THE TOLERANCE. None: a screen name, a count, and a length are exact.

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

/** Level-ups queued before the overlay opens: the figure the item names. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("accepts one offer and opens the next overlay intact on one Enter press", async () => {
  isolate(h);
  const opened = await openLevelUp(h, QUEUED);
  assertEqual(opened.screen, "levelup", "the screen the press is made from");
  assertEqual(
    opened.run.pendingLevelUps,
    QUEUED,
    "the level-ups queued before the press",
  );
  assertLength(opened.run.offers, OFFER_COUNT, "the first overlay's offers");

  const after = await tap(h, "Enter");
  captureStill(h, "once");

  assertEqual(after.screen, "levelup", "the screen one Enter left the game on");
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "the level-ups still queued after one Enter",
  );
  assertLength(
    after.run.offers,
    OFFER_COUNT,
    "the next overlay's own offers after one Enter",
  );
});
