// Wick — audio/cue-gem-once-per-tick: a tick that collects five gems at the
// lamplighter's center plays `gem` exactly once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`gem` | A gem is collected. At most once per
//     tick", and "at most once on that tick".
//   - specs/world.md (One tick, phase 9): "every gem within `COLLECT_RADIUS`
//     is collected, this tick's drops and the gems a draft attracted on this
//     tick included", so five gems on the lamplighter's center are all
//     collected on the same tick.
//   - specs/instrumentation.md (`spawnGem`): each call "Places one unattracted
//     gem of `tier` ... with the next id", and a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `gem` play across the one collecting tick, with no
// gem left on the field as the evidence that all five were collected together.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding the five gems and
// nothing else, no weapon held and every driver switch off. All five sit on the
// lamplighter's own center, a distance of `0`, so the collection condition holds
// for every one of them on the first tick and the tick raises the gem event five
// times. `isolate` poses level `ISOLATE_LEVEL` (50), whose `xpToNext` of 495 the
// five small gems' 5 experience cannot reach, so no overlay opens over the
// reading.
//
// TOLERANCE. None. Every reading is a count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  spawnGemAt,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

/** How many gems the review item collects on one tick. */
const GEMS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays gem once for five gems collected on one tick", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  for (let i = 0; i < GEMS; i += 1) {
    spawnGemAt(h, "small", player.x, player.y);
  }
  assertEqual(h.snapshot().run.gems.length, GEMS, "the gems posed at center");
  const cues = onCue(h);

  const after = await captureReplay(h, "once", () => h.tick(1));

  assertEqual(after.run.gems.length, 0, "gems left after the collecting tick");
  assertPlayed(cues, "gem", 1, "gem cues on the tick five gems were collected");
});
