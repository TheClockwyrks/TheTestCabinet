// Wick — audio/cue-gem: the tick on which a gem is collected plays `gem`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`gem` | `CUES.gem` | A gem is collected. At most
//     once per tick", and "Each is played on the tick its event happens".
//   - specs/world.md (One tick, phase 9): "every gem within `COLLECT_RADIUS`
//     is collected"; Attraction and flight: "a gem whose center is at most
//     `COLLECT_RADIUS` from the lamplighter's center is collected on that
//     tick: it is removed".
//   - specs/instrumentation.md (`spawnGem`): "Places one unattracted gem of
//     `tier` ... at `(x, y)`", and a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `gem` play across the one tick that collects the
// gem, with the field left holding no gem as the evidence that a collection
// happened at all.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field
// but the one gem, no weapon held, and every driver switch off, so nothing
// else can raise a cue on the tick. The gem is placed on the lamplighter's own
// center, a distance of `0` and so inside `COLLECT_RADIUS` (8) whatever the
// build's pickup radius, which makes the collection the first tick's only
// event. `isolate` poses level `ISOLATE_LEVEL` (50), whose `xpToNext` of 495
// no single small gem can reach, so no level-up overlay opens on top of the
// reading.
//
// TOLERANCE. None. Both readings are counts.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays gem once on the tick the gem is collected", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);
  const cues = onCue(h);

  const after = await captureReplay(h, "gem", () => h.tick(1));

  assertEqual(after.run.gems.length, 0, "gems left after the collecting tick");
  assertPlayed(cues, "gem", 1, "gem cues on the collecting tick");
});
