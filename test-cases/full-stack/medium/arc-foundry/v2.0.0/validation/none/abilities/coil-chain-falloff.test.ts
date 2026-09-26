// abilities/coil-chain-falloff — each leap lands a fraction of the last.
//
// specs/components.md fixes the falloff: "Each leap deals `COIL_FALLOFF` (`0.7`)
// times the previous hit's damage, so the primary takes full damage, the first
// leap `0.7` of it, the second `0.49`, and so on."
//
// The same line as `coil-chain-leaps`, read for the figures rather than for the
// reach: the primary loses the Scrap Coil's `5`, the first leap `3.5` and the
// second `2.45`. Nothing on the yard carries an aura, so the shot's damage is the
// bare figure the quality ladder gives, and the three losses are the falloff
// applied to it once, twice, and not at all. The units are Dynamos at a wave deep
// enough that none of the three losses can kill one, so every figure is read off a
// unit that is still standing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { COIL_FALLOFF, componentDamage } from "../constants";
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

/** The tier the falloff is read at. */
const TIER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the full hit, then 0.7 of it, then 0.49 of it", async () => {
  await openYard(h, { wave: 5 });
  const id = await standComponent(h, "coil", TIER, ANCHOR.col, ANCHOR.row);
  await h.debug.setTargeting(id, "nearest");
  const structure = structureById(await h.snapshot(), id);

  const line: number[] = [];
  for (let index = 0; index < LINE; index += 1) {
    line.push(
      await parkUnit(h, "dynamo", {
        x: structure.cx + FIRST + GAP * index,
        y: structure.cy,
      }),
    );
  }

  const before = await h.snapshot();
  const after = await captureReplay(h, "falloff", () =>
    awaitImpact(h, line[0]!),
  );

  const shot = componentDamage("coil", TIER);
  for (const [index, unit] of line.entries()) {
    const took = unitById(before, unit).hp - unitById(after, unit).hp;
    if (index <= 2) {
      assertCloseTo(
        took,
        shot * COIL_FALLOFF ** index,
        6,
        `the health unit ${index + 1} of the line lost: ${shot} through ` +
          `${index} leap${index === 1 ? "" : "s"} of ${COIL_FALLOFF} ` +
          `(specs/components.md)`,
      );
    } else {
      assertEqual(took, 0, `the health unit ${index + 1} of the line lost`);
    }
  }
});
