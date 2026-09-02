// pickups/elites-make-no-draw — an elite kill draws for nothing: it leaves its
// chest and touches the generator not at all.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "Each
// common enemy killed by a weapon draws from the game's seeded random
// generator on the tick it dies ... Elites and the Dark make no draw; an elite
// drops its chest, and the Dark drops nothing." specs/enemies.md ("Drops")
// gives an elite "One chest" and no gem, and specs/state.md says of `rngState`
// that it is "the state of the game's one seeded random generator ... every
// random draw advances it: a spawn's angle and type, an offer draw, a puddle's
// landing point, a strike's target, a chest's fallback item, a swarm's
// direction, and the bread and draft draws". So the tick an elite dies on
// leaves `rngState` exactly as it found it, and leaves one chest and no gem.
//
// THE WORLD. One isolated `playing` run, seeded once, in which `KILLS` (20)
// mothwings are killed in turn by posed Ember bolts, each `FIRST` (3000) units
// or more from the lamplighter and `SPACING` (200) units from its neighbours,
// so no chest is ever collected, nothing is ever attracted, and each kill's
// chest can be told from the ones before it. Every driver switch is off, so
// spawning and the scripted events cannot draw for a spawn's angle or type,
// and no weapon is held, so nothing that lands at random can fire; the
// generator's state is therefore untouched by anything but the kill under the
// reading. Twenty kills rather than one, because a build that draws and
// discards, or draws only sometimes, is caught by the run of readings rather
// than by a single one.
//
// WHAT IS READ. Around each of the twenty killing ticks: `rngState` after the
// tick against `rngState` before it, the pickups risen by exactly one chest at
// that mothwing's center, and no gem anywhere on the field.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the chest's position, the enemy's
// posed center copied over; none on `rngState`, a generator state that either
// advanced or did not, and none on the counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { armKill } from "./night";

/** The elite killed: specs/enemies.md ranks the mothwing `elite`. */
const TYPE = "mothwing";

/** How many kills the reading is taken over. */
const KILLS = 20;

/** Where the first kill happens, far outside every collection distance. */
const FIRST = 3000;

/** Units between one kill's point and the next. */
const SPACING = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves each mothwing's chest alone and rngState untouched across 20 kills", async () => {
  isolate(h);

  for (let killed = 0; killed < KILLS; killed += 1) {
    const at = armKill(h, TYPE, FIRST + killed * SPACING, 0);
    const before = h.snapshot();

    const after = await h.tick(1);

    assertEqual(
      after.rngState,
      before.rngState,
      `rngState across the tick that killed ${TYPE} ${killed + 1} of ${KILLS}`,
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
