// pickups/elites-make-no-draw — an elite kill draws for no pickup.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "Each common
// enemy killed by a weapon draws from the game's seeded random generator on the
// tick it dies ... Elites and the Dark make no draw; an elite drops its chest,
// and the Dark drops nothing." specs/enemies.md ("Drops") gives an elite one
// chest and no gem. specs/instrumentation.md ("A deterministic core") makes the
// absence of a draw readable: the game "holds one pseudo-random generator ...
// keeping its whole state in `rngState`, and every random draw comes from it".
// So the tick of an elite kill leaves `rngState` exactly as it found it, and
// leaves exactly one chest and no gem. A build that runs the common roll for
// every kill advances the generator on each of these ticks and, once in fifty,
// leaves a bread or a draft beside the chest.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: `spawning` and `events`
// off, so no spawn angle or type is drawn; no weapon held, so nothing of the
// lamplighter's own draws a puddle's landing point, a strike's target, or a
// swarm's direction; every other switch off and nothing else alive, so the tick
// that is read holds one death and nothing else. Each mothwing stands at its own
// point, `KILL_POINTS` apart and at least `500` units from the lamplighter, far
// outside the pickup collection distance, so its chest lies where it dropped
// rather than opening an overlay. The kill is the real one: the elite's health
// is posed down with `setEnemyHp`, and a level-1 Ember bolt posed on its center
// carries `10` damage, so the next tick's phase 6 takes it below `0`. `ROUNDS`
// (`20`) ticks are read one at a time, because one unchanged reading could be a
// generator that happens to return to its state and twenty cannot.
//
// THE TOLERANCE. None on `rngState`, "a whole number", or on the counts;
// `POSITION_TOL` (`1e-6`) on the chest's center, a copy of the posed one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newGems,
  newPickups,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";
import { killPoint } from "./stage";

/** The elite each kill is: specs/enemies.md gives it rank `elite` and a chest. */
const ELITE = "mothwing";

/** The health it is posed at: low enough for one level-1 bolt to end it. */
const POSED_HP = 1;

/** Elite kills read, one tick each. */
const ROUNDS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves rngState untouched and exactly one chest on each of twenty elite kills", async () => {
  await isolate(h);

  for (let round = 0; round < ROUNDS; round += 1) {
    const at = killPoint(round);
    const elite = await placeEnemy(h, ELITE, at.x, at.y);
    await h.debug.setEnemyHp(elite.id, POSED_HP);
    await placeProjectile(h, "ember", at.x, at.y, 0, 0, 0);
    const before = await h.snapshot();

    const after = await h.step(1);

    assertEqual(
      after.run.kills,
      before.run.kills + 1,
      `the kills the tick of elite ${round} made`,
    );
    assertEqual(
      after.rngState,
      before.rngState,
      `the generator's state after the tick of elite ${round}`,
    );
    assertLength(
      newGems(before, after),
      0,
      `the gems the tick of elite ${round} dropped`,
    );
    const dropped = newPickups(before, after);
    assertLength(dropped, 1, `the pickups the tick of elite ${round} dropped`);
    assertEqual(dropped[0]!.kind, "chest", `the drop of elite ${round}`);
    assertNear(
      dropped[0]!.x,
      at.x,
      POSITION_TOL,
      `the chest's x after the tick of elite ${round}`,
    );
    assertNear(
      dropped[0]!.y,
      at.y,
      POSITION_TOL,
      `the chest's y after the tick of elite ${round}`,
    );
  }

  await captureStill(h, "chest");
});
