// abilities/coil-leap-cap — the chain stops after the leaps the tier buys.
//
// specs/components.md fixes the ceiling per tier: "`COIL_LEAPS` holds the maximum
// number of additional leaps by tier", `2` at Scrap and Tuned, `3` at Charged and
// Primed, `4` at Tesla-Prime. It is its own point because a chain with the right
// reach and no ceiling clears a packed line in one shot, which is a different game
// from the one the table describes.
//
// A line of eight held units stands sixty apart, every neighbour inside
// `COIL_LEAP_RANGE`, so the chain never runs out of somewhere to go and only the
// ceiling can stop it. One shot is fired at each of the five tiers in turn, on a
// yard emptied and rebuilt between them, and the count of units that lost health
// is held against `1 + COIL_LEAPS[tier]`. The wave is deep enough that no tier's
// primary hit can kill a Dynamo, so "lost health" stays readable at Tesla-Prime.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COIL_LEAP_RANGE, COIL_LEAPS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  TIERS,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** The first unit's distance from the centre: inside every tier's radius. */
const FIRST = 40;

/** The gap between neighbours, inside COIL_LEAP_RANGE. */
const GAP = 60;

/** How many units stand in the line: more than any tier's chain can reach. */
const LINE = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes 1 + COIL_LEAPS[tier] units at every tier of the ladder", async () => {
  openYard(h, { wave: 5 });

  await captureReplay(h, "cap", async () => {
    for (const tier of TIERS) {
      emptyYard(h);
      const id = standComponent(h, "coil", tier, ANCHOR.col, ANCHOR.row);
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
      const after = await awaitImpact(h, line[0]!);
      const struck = line.filter(
        (unit) => unitById(after, unit).hp < unitById(before, unit).hp,
      ).length;

      assertEqual(
        struck,
        1 + COIL_LEAPS[tier - 1]!,
        `units struck by one shot at tier ${tier}: the primary plus the ` +
          `${COIL_LEAPS[tier - 1]!} additional leaps that tier buys, with ` +
          `${LINE} units standing ${GAP} apart inside the ` +
          `${COIL_LEAP_RANGE} leap range (specs/components.md)`,
      );
    }
  });
});
