// abilities/coil-chain-leaps — the hit walks down the line.
//
// specs/components.md fixes the Coil's chain: "The Coil's projectile hits its
// primary target, then the hit leaps to the nearest unit it has not already struck
// within `COIL_LEAP_RANGE` (`70`) of the last unit struck, and again from there."
//
// The yard holds one Coil and a line of four held units, sixty apart — inside the
// leap range, and measured unit to unit, which is what the rule measures. The
// primary is the only one of the four the Coil could pick, since the line runs
// away from the structure and its priority is `nearest`, so the chain's starting
// point is not in doubt. What is read is which units lost health: the primary and
// the two the Scrap tier's two additional leaps reach, and not the fourth, which
// is beyond them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { COIL_LEAP_RANGE, COIL_LEAPS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** The first unit's distance from the centre: inside the Scrap Coil's `110`. */
const FIRST = 40;

/** The gap between neighbours, inside COIL_LEAP_RANGE. */
const GAP = 60;

/** How many units stand in the line: one more than the chain can reach. */
const LINE = 4;

/** The tier the chain is read at, and the leaps it buys. */
const TIER = 1;
const LEAPS = COIL_LEAPS[TIER - 1]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes the primary and the two units the Scrap tier's leaps reach", async () => {
  openYard(h, { wave: 5 });
  const id = standComponent(h, "coil", TIER, ANCHOR.col, ANCHOR.row);
  h.debug.setTargeting(id, "nearest");
  const structure = structureById(h.snapshot(), id);

  const line: number[] = [];
  for (let index = 0; index < LINE; index += 1) {
    line.push(
      parkUnit(h, "dynamo", {
        x: structure.cx + FIRST + GAP * index,
        y: structure.cy,
      }),
    );
  }

  const before = h.snapshot();
  const after = await captureReplay(h, "chain", () => awaitImpact(h, line[0]!));

  // The primary and every leap the tier buys lost health; nothing beyond did.
  for (const [index, unit] of line.entries()) {
    const took = unitById(before, unit).hp - unitById(after, unit).hp;
    if (index <= LEAPS) {
      assertGreaterThan(
        took,
        0,
        `the health unit ${index + 1} of the line lost: the chain reaches ` +
          `${LEAPS} units past the primary at this tier, each within ` +
          `${COIL_LEAP_RANGE} of the last (specs/components.md)`,
      );
    } else {
      assertEqual(
        took,
        0,
        `the health unit ${index + 1} of the line lost: it is past the ` +
          `${LEAPS} leaps this tier buys`,
      );
    }
  }
});
