// targeting/tie-to-further-along — a tie goes to the unit further along the chain.
//
// specs/components.md fixes the rule that makes every priority deterministic:
// "Ties resolve toward the unit further along the chain, so the choice is
// deterministic." It is its own point because it is what a build gets wrong by
// leaving the choice to whatever order its own list happened to be in — which
// looks fine until two units line up exactly.
//
// Two priorities are read, because a tie is reached differently under each. Under
// `nearest` the pair stands at the same distance on opposite sides of the shooter;
// under `strongest` the pair carries the same health. Both pairs head for
// different checkpoints, which is what the tie-break resolves on. Each priority is
// read twice, with the two units posed in the other order the second time, so a
// build that answers with whichever unit it was handed first fails one of the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { Targeting } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";
import { firstShotTarget, standShooter } from "./scenario";

/** The two checkpoints the tied pair head for. */
const AHEAD = 6;
const BEHIND = 2;

/** The two places, the same distance from the centre on opposite sides. */
const LEFT = { x: -60, y: 0 };
const RIGHT = { x: 60, y: 0 };

/** One health both units of the `strongest` pair carry. */
const TIED_HP = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose a tied pair and read which of the two the structure shot.
 *
 * `aheadFirst` decides which of the two is released first, so the same tie can be
 * put to the build in both orders.
 */
async function shootTiedPair(
  harness: Harness,
  priority: Targeting,
  aheadFirst: boolean,
): Promise<{ target: number | null; ahead: number }> {
  await harness.debug.clearStructures();
  await harness.debug.clearUnits();
  await harness.debug.clearProjectiles();
  const shooter = await standShooter(harness, priority);

  const release = async (
    waypoint: number,
    offset: { x: number; y: number },
  ): Promise<number> =>
    releaseUnit(harness, "dynamo", {
      waypoint,
      at: { x: shooter.cx + offset.x, y: shooter.cy + offset.y },
      hp: TIED_HP,
      frozen: true,
    });

  let ahead: number;
  if (aheadFirst) {
    ahead = await release(AHEAD, RIGHT);
    await release(BEHIND, LEFT);
  } else {
    await release(BEHIND, LEFT);
    ahead = await release(AHEAD, RIGHT);
  }

  return { target: await firstShotTarget(harness), ahead };
}

it("resolves a tie under nearest and under strongest toward the further unit", async () => {
  await openYard(h, { wave: 1 });

  await captureReplay(h, "tie", async () => {
    for (const priority of ["nearest", "strongest"] as const) {
      for (const aheadFirst of [true, false]) {
        const shot = await shootTiedPair(h, priority, aheadFirst);
        assertEqual(
          shot.target,
          shot.ahead,
          `the unit heading for checkpoint ${AHEAD} rather than the one ` +
            `heading for ${BEHIND}, with the pair tied under \`${priority}\` ` +
            `and the further unit released ${aheadFirst ? "first" : "second"} ` +
            `(specs/components.md)`,
        );
      }
    }
  });
});
