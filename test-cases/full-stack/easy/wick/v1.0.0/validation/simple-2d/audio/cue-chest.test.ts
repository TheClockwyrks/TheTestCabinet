// Wick — audio/cue-chest: the tick that collects a chest and opens the overlay
// plays `chest`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`chest` | `CUES.chest` | A chest overlay opens",
//     and "Each is played on the tick its event happens".
//   - specs/progression.md (The chest overlay): "On the tick it is collected
//     the tick runs to completion, the chest's result is applied ...,
//     `chestResult` records it, and `screen` becomes `chest`".
//   - specs/world.md (Pickups, Collection): "A pickup is collected on any tick
//     on which the distance between its center and the lamplighter's center is
//     less than `PICKUP_ITEM_RADIUS` (16) plus `PLAYER_RADIUS`".
//   - specs/instrumentation.md (`setScreen`): "The chest overlay is reached
//     through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//     tick, which is the real collection path"; a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `chest` play across the one collecting tick, with
// `screen` on `chest` as the evidence that the overlay really opened.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding the chest and
// nothing else, no weapon and no passive held, and every driver switch off, so
// nothing else on the night can raise a cue on the tick. The chest sits on the
// lamplighter's own center, a distance of `0`, so the collection condition
// holds on the first tick. With nothing held the chest's result is the heal of
// rule 3 (specs/evolutions.md), which raises no `evolve` cue of its own.
//
// TOLERANCE. None. The reading is a count and the screen is discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  openChest,
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

it("plays chest once on the tick the chest is collected", async () => {
  isolate(h);
  const cues = onCue(h);

  const after = await captureReplay(h, "chest", () => openChest(h));

  assertEqual(after.screen, "chest", "the screen after the collecting tick");
  assertPlayed(cues, "chest", 1, "chest cues on the collecting tick");
});
