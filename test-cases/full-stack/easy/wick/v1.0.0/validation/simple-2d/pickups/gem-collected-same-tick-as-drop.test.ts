// pickups/gem-collected-same-tick-as-drop — a gem dropped at the lamplighter is
// attracted, moved, and collected on the tick it drops.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick", phase 9): "Every
// gem within `pickupRadius` becomes attracted, every attracted gem that existed
// before this tick moves, and every gem within `COLLECT_RADIUS` is collected,
// this tick's drops and the gems a draft attracted on this tick included. A gem
// dropped on this tick is attracted and collected by the same tests as any
// other and takes its first flight step on the next tick." The kill itself is
// phase 6, earlier in the same tick: "an enemy whose `hp` is at or below `0`
// dies: its drop and its bread or draft land at its center". specs/enemies.md
// ("The roster") gives the moth the `small` drop and specs/world.md ("Gems")
// gives `small` the value 1, with `xpMul` 1 while no Soot is held. So a moth
// killed on the lamplighter's own center leaves no gem behind in that tick's
// snapshot and `xp` has risen by 1.
//
// THE WORLD. An isolated `playing` run: nothing else alive, nothing on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// but this kill can leave anything on the field and nothing else can change
// `xp`. The moth stands on the lamplighter's center with its `hp` posed to 1
// and one Ember bolt on that point, so the death is decided by the tick rather
// than by the pose; `enemyContact` is off, so the moth standing there costs no
// health, and `enemyMotion` is off, so it stays where it was put. The drop
// therefore lands at distance 0, inside both `pickupRadius` (48) and
// `COLLECT_RADIUS` (8), which is the case phase 9 is being read for. `drops` is
// turned back on because the drop is half of what this tick is about;
// `progression` stays off, so the gain reaches `xp` and opens no overlay over
// the reading.
//
// WHAT IS READ. The snapshot of that single tick: the moth gone, no gem on the
// field, and `xp` risen by 1. A build that leaves the tick's own drops for the
// next tick leaves a gem lying at the center and no experience gained.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `xp`, "a real number" read back as a
// double; none on the counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, GEM_VALUES } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { armKill } from "./night";

/** The common whose drop is read, and the tier specs/enemies.md gives it. */
const TYPE = "moth";
const TIER = "small";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no gem and raises xp by 1 on the tick a moth dies at the lamplighter", async () => {
  const posed = isolate(h);
  // The gem the death drops is what this tick is about; `progression` stays off, so the gain lands on `xp` alone.
  enable(h, "drops");
  armKill(h, TYPE, 0, 0);
  assertLength(h.snapshot().run.gems, 0, "gems before the killing tick");

  const after = await h.tick(1);
  captureStill(h, "same");

  assertLength(after.run.enemies, 0, "enemies after the killing tick");
  assertLength(after.run.gems, 0, "gems in the snapshot of the killing tick");
  assertWithin(
    after.run.xp - posed.run.xp,
    GEM_VALUES[TIER],
    FIGURE_TOLERANCE,
    "the experience the tick's own drop granted",
  );
});
