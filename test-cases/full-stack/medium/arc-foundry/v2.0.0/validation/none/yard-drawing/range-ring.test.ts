// yard-drawing/range-ring — the ring is drawn, at the range the structure reports.
//
// `specs/hud.md` lists "the range ring of the held or selected structure" among
// the few things the yard draws over the map, and `specs/components.md` fixes
// range as "a radius measured from the center of the structure's footprint" that
// climbs `RANGE_PER_TIER` a tier — `100` for a Capacitor at Scrap and `132` at
// Tesla-Prime.
//
// TWO CIRCLES, TWO TIERS. The yard is sampled on the circle of each tier's own
// radius, with the structure selected and with nothing selected. Selecting the
// Scrap Capacitor has to move the circle at `100`, and selecting the Tesla-Prime
// one has to move the circle at `132`; and the Scrap one must leave the circle at
// `132` alone, which is what makes the ring follow the range rather than being
// drawn at some radius of the build's own. The far circle is the one held fixed
// because it is outside both readings of the smaller range, so a build that
// shades the whole disc inside the ring passes it exactly as a build that strokes
// the ring does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  DISTINCT,
  type Harness,
  maxDistance,
  openYard,
  sample,
  standComponent,
  structureById,
} from "../harness";
import { componentRange, structureCenter, type Tier } from "../constants";

const TYPE = "capacitor";
const ANCHOR = { col: 10, row: 10 };
/** How many points are read around a circle. */
const AROUND = 64;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Points evenly spaced around the circle of that radius about the footprint. */
function circle(radius: number): { x: number; y: number }[] {
  const center = structureCenter(ANCHOR.col, ANCHOR.row);
  return Array.from({ length: AROUND }, (_, i) => {
    const angle = (2 * Math.PI * i) / AROUND;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

const NEAR = componentRange(TYPE, 1);
const FAR = componentRange(TYPE, 5);

it("draws the ring at the selected structure's own range", async () => {
  await openYard(h);

  const onNear = circle(NEAR);
  const onFar = circle(FAR);

  for (const tier of [1, 5] as Tier[]) {
    await h.debug.clearStructures();
    const id = await standComponent(h, TYPE, tier, ANCHOR.col, ANCHOR.row);
    await h.debug.clearSelection();
    assertEqual(
      structureById(await h.snapshot(), id).range,
      componentRange(TYPE, tier),
      `the range a tier-${tier} ${TYPE} reports (specs/components.md)`,
    );

    const unselectedNear = await sample(h, onNear);
    const unselectedFar = await sample(h, onFar);

    await h.debug.select(id);
    const selectedNear = await sample(h, onNear);
    const selectedFar = await sample(h, onFar);
    if (tier === 5) await captureStill(h, "ring");

    const own = tier === 1 ? onNear : onFar;
    assertGreaterThan(
      maxDistance(
        tier === 1 ? unselectedNear : unselectedFar,
        tier === 1 ? selectedNear : selectedFar,
      ),
      DISTINCT,
      `how far selecting a tier-${tier} ${TYPE} moves the yard on the circle ` +
        `of its own range, ${componentRange(TYPE, tier)}, over ${own.length} ` +
        "points, in RGB distance",
    );

    if (tier === 1) {
      assertEqual(
        maxDistance(unselectedFar, selectedFar) > DISTINCT,
        false,
        `whether selecting a tier-1 ${TYPE}, whose range is ${NEAR}, moves ` +
          `the yard out at ${FAR}`,
      );
    }
  }
});
