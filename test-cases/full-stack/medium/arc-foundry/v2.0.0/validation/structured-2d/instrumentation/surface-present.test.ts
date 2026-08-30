// instrumentation/surface-present — the build returned the debug and automation
// surface `specs/instrumentation.md` requires, and that surface is really wired to
// the running game.
//
// EVERY PART OF THIS IS THE BUILD'S. The engine holds no surface of its own: the
// build's game instance's `initialize` returns it, the engine keeps that same
// object, and `engine.debug` is the only way one reaches a check
// (specs/instrumentation.md). Every other automated point in this project poses
// its scenario through it, so a build that returned nothing there leaves nothing
// to drive; the harness stands a failing proxy in its place so the fault lands
// HERE, by name, rather than inside some other check's setup.
//
// TWO HALVES. The first is that the operations are THERE, reflected without being
// invoked. The second is that the surface is LIVE: a surface whose operations are
// all present and whose `snapshot` reports a plausible object unconnected to the
// game is present and useless. So a component is stood up through the surface, and
// the game is asked about it two ways that cannot both be faked cheaply — the
// snapshot reports it, and the pixels the build draws change where it stands.
//
// THE CLOCK AND THE INPUT ARE NOT ON THE SURFACE. Under this engine both belong to
// the runtime, and `specs/instrumentation.md` strikes them from the operation
// list, so demanding them here would fail a perfectly conformant build.

import { afterEach, beforeEach, it } from "vitest";

import { TILE } from "../../src/constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  FOUNDRY_DEBUG_VERSION,
  REQUIRED_OPS,
  captureStill,
  createHarness,
  openYard,
  standComponent,
  structureById,
  structureCenter,
  type Harness,
  type Point,
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

it("returns a whole surface from its instance's initialize", () => {
  // `engine.debug` is whatever the build's game instance returned from
  // `initialize`, so reading it is the check: there is no page property to look
  // for and nothing the harness could have supplied in the build's place.
  assertNotNull(h.engine.debug, "engine.debug");
  assertEqual(typeof h.engine.debug, "object", "typeof engine.debug");

  const probed = h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    FOUNDRY_DEBUG_VERSION,
    "the version the surface reports (specs/instrumentation.md)",
  );
  for (const operation of REQUIRED_OPS) {
    assertEqual(probed.ops[operation], "function", `engine.debug.${operation}`);
  }
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
  // than a bookkeeping copy beside it (`specs/yard.md` draws every structure on
  // the yard, over its own footprint).
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
