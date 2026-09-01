// Wick — audio/cue-pickup-draft: the tick on which a draft is collected plays
// `pickup`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`pickup` | `CUES.pickup` | Bread or a draft is
//     collected", and "Each is played on the tick its event happens".
//   - specs/world.md (Pickups): a draft's row, "`draft` ... Every gem on the
//     field becomes attracted"; Collection: "Every bread and draft that meets
//     the condition on a tick is collected on that tick", the condition being a
//     distance "less than `PICKUP_ITEM_RADIUS` (16) plus `PLAYER_RADIUS`".
//   - specs/instrumentation.md (`spawnPickup`): "Places one pickup of `kind`
//     ... with the next id"; a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `pickup` play across the one collecting tick, with
// the field left holding no pickup as the evidence that the draft was
// collected. The draft is its own point beside the bread's, because a build
// that sounds the cue for one kind and not the other must grade differently
// from one that sounds it for both.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding the draft and
// nothing else, no weapon held, and every driver switch off. No gem is on the
// field, so what the draft does to gems cannot bring a `gem` collection onto
// the same tick. The draft sits on the lamplighter's own center, a distance of
// `0`, so the collection condition holds on the first tick.
//
// TOLERANCE. None. Both readings are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays pickup once on the tick the draft is collected", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "draft", player.x, player.y);
  const cues = onCue(h);

  const after = await captureReplay(h, "draft", () => h.tick(1));

  assertEqual(
    after.run.pickups.length,
    0,
    "pickups left after the collecting tick",
  );
  assertPlayed(
    cues,
    "pickup",
    1,
    "pickup cues on the tick the draft was collected",
  );
});
