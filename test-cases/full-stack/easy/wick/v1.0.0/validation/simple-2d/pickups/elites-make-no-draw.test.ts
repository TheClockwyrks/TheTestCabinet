// pickups/elites-make-no-draw — an elite kill makes no drop roll: it leaves
// its chest and a posed drop standing.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "each
// common enemy killed by a weapon rolls for a pickup on the tick it dies ...
// Elites and the Dark make no roll; an elite drops its chest, and the Dark
// drops nothing." specs/enemies.md ("Drops") gives an elite "One chest" and
// no gem, and specs/instrumentation.md ("Drawn outcomes"), `setNextDrop`:
// "an elite's death, and the Dark's death leave it standing". So the tick an
// elite dies on leaves the posed `nextDrop` exactly as it found it, and leaves
// one chest and no gem; a build that runs the common roll for every kill
// consumes the pose on the first elite and, with `bread` posed, leaves a
// bread beside its chest.
//
// THE WORLD. One isolated `playing` run with `drops` alone turned back on, in
// which `KILLS` (20) mothwings are killed in turn by posed Ember bolts, each
// `FIRST` (3000) units or more from the lamplighter and `SPACING` (200) units
// from its neighbours, so no chest is ever collected, nothing is ever
// attracted, and each kill's chest can be told from the ones before it. No
// weapon is held and every other switch is off, so nothing else can leave a
// pickup. Twenty kills rather than one, because a build that rolls only
// sometimes is caught by the run of readings rather than by a single one.
//
// WHAT IS READ. Around each of the twenty killing ticks: `nextDrop` still
// `bread`, the pickups risen by exactly one chest at that mothwing's center,
// and no gem anywhere on the field.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the chest's position, the enemy's
// posed center copied over; none on the pose or the counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { armKill } from "./night";

/** The elite killed: specs/enemies.md ranks the mothwing `elite`. */
const TYPE = "mothwing";

/** How many kills the reading is taken over. */
const KILLS = 20;

/** Where the first kill happens, far outside every collection distance. */
const FIRST = 3000;

/** Units between one kill's point and the next. */
const SPACING = 200;

/** The drop posed for the next common kill, which no elite may consume. */
const POSED = "bread";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves each mothwing's chest alone and the posed drop standing across 20 kills", async () => {
  isolate(h);
  // The drop the elite leaves is the requirement; every other faculty stays held.
  enable(h, "drops");
  h.debug.setNextDrop(POSED);

  for (let killed = 0; killed < KILLS; killed += 1) {
    const at = armKill(h, TYPE, FIRST + killed * SPACING, 0);

    const after = await h.tick(1);

    assertEqual(
      after.run.nextDrop,
      POSED,
      `nextDrop across the tick that killed ${TYPE} ${killed + 1} of ${KILLS}`,
    );
    assertLength(after.run.enemies, 0, `enemies after kill ${killed + 1}`);
    assertLength(after.run.gems, 0, `gems after kill ${killed + 1}`);
    assertLength(
      after.run.pickups,
      killed + 1,
      `pickups after kill ${killed + 1}`,
    );
    const chest = after.run.pickups[killed];
    assertEqual(chest.kind, "chest", `the pickup kill ${killed + 1} left`);
    assertWithin(
      chest.x,
      at.x,
      FIGURE_TOLERANCE,
      `the x of the chest kill ${killed + 1} left`,
    );
    assertWithin(
      chest.y,
      at.y,
      FIGURE_TOLERANCE,
      `the y of the chest kill ${killed + 1} left`,
    );
  }

  captureStill(h, "chest");
});
