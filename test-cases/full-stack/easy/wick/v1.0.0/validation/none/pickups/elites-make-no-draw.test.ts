// pickups/elites-make-no-draw — an elite kill makes no drop roll.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "each
// common enemy killed by a weapon rolls for a pickup on the tick it dies ...
// Elites and the Dark make no roll; an elite drops its chest, and the Dark
// drops nothing." specs/enemies.md ("Drops") gives an elite one chest and no
// gem. specs/instrumentation.md ("Drawn outcomes") makes the absence of a roll
// readable: `setNextDrop(kind)` is consumed by "the next common enemy killed
// by a weapon while `drops` is on", and "an elite's death, and the Dark's death
// leave it standing". So the tick of an elite kill leaves exactly one chest, no
// gem, and the posed `nextDrop` exactly as it found it. A build that runs the
// common roll for every kill consumes the pose on the first elite and, with
// `bread` posed, leaves a bread beside the chest.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `drops` alone turned
// back on, which is the faculty the roll belongs to; no weapon held, so nothing
// of the lamplighter's own fires; every other switch off and nothing else
// alive, so the tick that is read holds one death and nothing else. Each
// mothwing stands at its own point, `killPoint`s apart and at least `500` units
// from the lamplighter, far outside the pickup collection distance, so its
// chest lies where it dropped rather than opening an overlay. The kill is the
// real one: the elite's health is posed down with `setEnemyHp`, and a level-1
// Ember bolt posed on its center carries `10` damage, so the next tick's phase
// 6 takes it below `0`. `ROUNDS` (`20`) kills are read one at a time under one
// standing pose.
//
// THE TOLERANCE. None on the counts and the pose; `POSITION_TOL` on the chest's
// center, a copy of the posed one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { killCommon, killPoint } from "./stage";

/** Elite kills read, one tick each. */
const ROUNDS = 20;

/** The drop posed for the next common kill, which no elite may consume. */
const POSED = "bread";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the posed drop standing and exactly one chest on each of twenty elite kills", async () => {
  await isolate(h, { on: ["drops"] });
  await h.debug.setNextDrop(POSED);

  for (let round = 0; round < ROUNDS; round += 1) {
    const kill = await killCommon(h, "mothwing", killPoint(round));

    assertEqual(
      kill.after.run.nextDrop,
      POSED,
      `nextDrop after the tick of elite ${round}, which makes no roll`,
    );
    assertLength(kill.gems, 0, `the gems the tick of elite ${round} dropped`);
    assertLength(
      kill.pickups,
      1,
      `the pickups the tick of elite ${round} dropped`,
    );
    assertEqual(kill.pickups[0]!.kind, "chest", `the drop of elite ${round}`);
    assertNear(
      kill.pickups[0]!.x,
      kill.at.x,
      POSITION_TOL,
      `the chest's x after the tick of elite ${round}`,
    );
    assertNear(
      kill.pickups[0]!.y,
      kill.at.y,
      POSITION_TOL,
      `the chest's y after the tick of elite ${round}`,
    );
  }

  await captureStill(h, "chest");
});
