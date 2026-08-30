// instrumentation/surface-present — the build installed the debug and automation
// surface `specs/instrumentation.md` requires, and that surface is really wired
// to the running game.
//
// EVERY PART OF THIS IS THE BUILD'S. An engineless run seeds no `src/` at all, so
// the surface itself — the global it is installed on, every operation, the version
// — is a deliverable of this point, and every other automated point in this
// project reaches the game through it. A build that never installed it leaves
// nothing to drive; the harness reports that as `surfaceFault` rather than by
// throwing, so the fault lands here rather than inside some other check's setup.
//
// TWO HALVES. The first is that the operations are THERE, reflected without being
// invoked. The second is that the surface is LIVE: a surface whose operations are
// all present and whose `snapshot` reports a plausible object unconnected to the
// game is present and useless. So a component is stood up through the surface, and
// the game is asked about it two ways that cannot both be faked cheaply — the
// snapshot reports it, and the pixels the build draws change where it stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TILE, structureCenter } from "../constants";
import {
  FOUNDRY_DEBUG_VERSION,
  HANDLE,
  REQUIRED_OPS,
  captureStill,
  createHarness,
  failSurface,
  openYard,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** A clear anchor in the middle of the Substation, well off every platform. */
const ANCHOR = { col: 20, row: 10 };

/** The component the point names, at the lowest tier so nothing else is implied. */
const TYPE = "capacitor";
const QUALITY = 1;

/** How many samples across the footprint the drawn-pixel read takes, per axis. */
const SAMPLES = 5;

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * specification requires, rather than with a comparison's rendering of it.
 *
 * This is the point whose whole job is to name that plainly, so it says what the
 * build owes on the `Expected:` line and what was found on the `Actual:` line.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

/** The points sampled across the footprint anchored at `ANCHOR`. */
function footprintSamples(): { x: number; y: number }[] {
  const center = structureCenter(ANCHOR.col, ANCHOR.row);
  const span = TILE; // half the 2x2 footprint, so every sample is inside it
  const points: { x: number; y: number }[] = [];
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

afterEach(async () => {
  await h.dispose();
});

it(`installs a whole surface on window.${HANDLE}`, async () => {
  requireSurface();

  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    FOUNDRY_DEBUG_VERSION,
    `window.${HANDLE}.version (specs/instrumentation.md)`,
  );
  for (const operation of REQUIRED_OPS) {
    assertEqual(
      probed.ops[operation],
      "function",
      `window.${HANDLE}.${operation}`,
    );
  }
});

it("stands a component up through the surface, and the game holds it", async () => {
  requireSurface();
  await openYard(h);

  // The frame the yard was drawn on before anything stood on it.
  await h.advance(1);
  const before = await h.pixels(footprintSamples());

  const id = await standComponent(h, TYPE, QUALITY, ANCHOR.col, ANCHOR.row);
  await h.advance(1);
  await captureStill(h, "posed");

  // The snapshot reports it, at the anchor it was asked for.
  const structure = structureById(await h.snapshot(), id);
  assertEqual(structure.kind, "component");
  assertEqual(structure.type, TYPE);
  assertEqual(structure.quality, QUALITY);
  assertEqual(structure.col, ANCHOR.col);
  assertEqual(structure.row, ANCHOR.row);

  // And the build drew it: the surface reaches the game the player sees rather
  // than a bookkeeping copy beside it (`specs/yard.md` draws every structure on
  // the yard, over its own footprint).
  const after = await h.pixels(footprintSamples());
  const changed = after.some((pixel, at) =>
    pixel.some((channel, band) => channel !== before[at]![band]),
  );
  assertTrue(
    changed,
    `the ${SAMPLES * SAMPLES} sampled pixels of the footprint at ` +
      `(${ANCHOR.col}, ${ANCHOR.row}) to change once a component stands there`,
  );
});
