// Wick — audio/cue-pickup-bread: the tick on which bread is collected plays
// `pickup`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`pickup` | `CUES.pickup` | Bread or a draft is
//     collected", and "Each is played on the tick its event happens".
//   - specs/world.md (Pickups, Collection): "A pickup is collected on any tick
//     on which the distance between its center and the lamplighter's center is
//     less than `PICKUP_ITEM_RADIUS` (16) plus `PLAYER_RADIUS`. Every bread and
//     draft that meets the condition on a tick is collected on that tick".
//   - specs/instrumentation.md (`spawnPickup`): "Places one pickup of `kind`
//     ... with the next id"; a pose "sounds nothing", and a posed pickup is
//     first collected on the next tick.
//
// WHAT IS READ. Exactly one `pickup` play across the one collecting tick, with
// the field left holding no pickup as the evidence that the bread was
// collected.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding the bread and
// nothing else, no weapon held, and every driver switch off, so nothing else
// can raise a cue on the tick. The bread sits on the lamplighter's own center,
// a distance of `0`, so the collection condition holds on the first tick.
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

it("plays pickup once on the tick the bread is collected", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "bread", player.x, player.y);
  const cues = onCue(h);

  const after = await captureReplay(h, "bread", () => h.tick(1));

  assertEqual(
    after.run.pickups.length,
    0,
    "pickups left after the collecting tick",
  );
  assertPlayed(
    cues,
    "pickup",
    1,
    "pickup cues on the tick bread was collected",
  );
});
