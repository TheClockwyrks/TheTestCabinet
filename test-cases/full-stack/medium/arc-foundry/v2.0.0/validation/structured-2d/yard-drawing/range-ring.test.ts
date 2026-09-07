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
//
// WHAT "MOVES" AND "LEAVES ALONE" MEAN HERE. Moved is `DRAWN`, the floor below
// which a sampling cannot tell a drawing from the host's own rounding, so a
// stroked outline, a shaded disc, a dotted arc and a faint tint all clear it and
// nothing about how the ring looks is read. Left alone is not a figure at all:
// `specs/hud.md` fixes what the yard draws and nothing that forbids a build from
// breathing it, so the far circle is watched unselected first and the selected
// reading is held against how far that circle travelled on its own.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  DRAWN,
  type Harness,
  idleSpread,
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
/**
 * The rate this check is driven at.
 *
 * EVERY FRAME A PIXEL READING IS TAKEN OVER IS A FRAME THE HOST HAS TO RASTERIZE,
 * so the frames a span is cut into are what such a check costs. The specification
 * fixes no frame size and guarantees that "an interval of simulation time reaches
 * the same state however it was divided into frames and whatever frame rate
 * produced it" (specs/instrumentation.md), so each span below is the span it
 * always was and only the number of frames it is divided into is this check's.
 */
const RING_HZ = 20;

/**
 * How many frames the far circle is watched over before anything is selected.
 *
 * Two seconds of them, which outlasts a full turn of any plausible idle pulse. A
 * shorter watch would report a circle caught mid-breath as steadier than it is,
 * and the reading it is the control for is the one that expects nothing.
 */
const IDLE_MOMENTS = 2 * RING_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: RING_HZ });
});

afterEach(() => {
  h.dispose();
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
  openYard(h);

  const onNear = circle(NEAR);
  const onFar = circle(FAR);

  for (const tier of [1, 5] as Tier[]) {
    h.debug.clearStructures();
    const id = standComponent(h, TYPE, tier, ANCHOR.col, ANCHOR.row);
    h.debug.clearSelection();
    assertEqual(
      structureById(h.snapshot(), id).range,
      componentRange(TYPE, tier),
      `the range a tier-${tier} ${TYPE} reports (specs/components.md)`,
    );

    // The tier-1 pass reads the far circle for a ring that must NOT be there, so
    // it learns first how far that circle travels with nothing selected.
    const idleFar = tier === 1 ? await idleSpread(h, onFar, IDLE_MOMENTS) : 0;

    const unselectedNear = await sample(h, onNear);
    const unselectedFar = await sample(h, onFar);

    h.debug.select(id);
    const selectedNear = await sample(h, onNear);
    const selectedFar = await sample(h, onFar);
    if (tier === 5) captureStill(h, "ring");

    const own = tier === 1 ? onNear : onFar;
    assertGreaterThan(
      maxDistance(
        tier === 1 ? unselectedNear : unselectedFar,
        tier === 1 ? selectedNear : selectedFar,
      ),
      DRAWN,
      `how far selecting a tier-${tier} ${TYPE} moves the yard on the circle ` +
        `of its own range, ${componentRange(TYPE, tier)}, over ${own.length} ` +
        "points, against the floor a reading needs to call anything drawn",
    );

    if (tier === 1) {
      assertLessThanOrEqual(
        maxDistance(unselectedFar, selectedFar),
        Math.max(DRAWN, idleFar),
        `how far selecting a tier-1 ${TYPE}, whose range is ${NEAR}, moves ` +
          `the yard out at ${FAR}, against how far that circle moves on its own`,
      );
    }
  }
});
