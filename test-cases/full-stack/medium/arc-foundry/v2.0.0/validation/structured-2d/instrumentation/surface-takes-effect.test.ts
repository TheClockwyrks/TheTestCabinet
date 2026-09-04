// instrumentation/surface-takes-effect — the surface is wired to the running
// game.
//
// A surface whose operations are all present and whose `snapshot` reports a
// plausible object unconnected to the yard is present and useless, so being
// present (`instrumentation/surface-complete`) and taking effect are two
// requirements and this one decides the second.
//
// HOW IT IS DECIDED. A component is stood up through the surface, and the game is
// asked about it two ways that cannot both be faked cheaply — the snapshot reports
// it at the anchor it was asked for, and the pixels the build draws change where
// it stands. `specs/yard.md` draws every structure on the yard over its own
// footprint, so the second is the requirement's own picture rather than an
// appearance choice.

import { afterEach, beforeEach, it } from "vitest";
import { type Point, structureCenter, TILE } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standComponent,
  structureById,
} from "../harness";

/** A clear anchor in the middle of the Substation, well off every platform. */
const ANCHOR = { col: 20, row: 10 };

/** The component the point names, at the lowest tier so nothing else is implied. */
const TYPE = "capacitor";
const QUALITY = 1;

/** How many samples across the footprint the drawn-pixel read takes, per axis. */
const SAMPLES = 5;

let h: Harness;

/** The points sampled across the footprint anchored at `ANCHOR`. */
function footprintSamples(): Point[] {
  const center = structureCenter(ANCHOR.col, ANCHOR.row);
  const span = TILE; // half the 2x2 footprint, so every sample is inside it
  const points: Point[] = [];
  for (let iy = 0; iy < SAMPLES; iy += 1) {
    for (let ix = 0; ix < SAMPLES; ix += 1) {
      points.push({
        x: center.x - span + ((2 * span) / (SAMPLES - 1)) * ix,
        y: center.y - span + ((2 * span) / (SAMPLES - 1)) * iy,
      });
    }
  }
  return points;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands a component up through the surface, and the game holds it", async () => {
  openYard(h);

  // The frame the yard was drawn on before anything stood on it.
  await h.advance(1);
  const before = h.pixels(footprintSamples());

  const id = standComponent(h, TYPE, QUALITY, ANCHOR.col, ANCHOR.row);
  await h.advance(1);
  captureStill(h, "posed");

  // The snapshot reports it, at the anchor it was asked for.
  const structure = structureById(h.snapshot(), id);
  assertEqual(structure.kind, "component");
  assertEqual(structure.type, TYPE);
  assertEqual(structure.quality, QUALITY);
  assertEqual(structure.col, ANCHOR.col);
  assertEqual(structure.row, ANCHOR.row);

  // And the build drew it: the surface reaches the game the player sees rather
  // than a bookkeeping copy beside it.
  const after = h.pixels(footprintSamples());
  const changed = after.some((pixel, at) =>
    pixel.some((channel, band) => channel !== before[at]![band]),
  );
  assertTrue(
    changed,
    `the ${SAMPLES * SAMPLES} sampled pixels of the footprint at ` +
      `(${ANCHOR.col}, ${ANCHOR.row}) to change once a component stands there`,
  );
});
