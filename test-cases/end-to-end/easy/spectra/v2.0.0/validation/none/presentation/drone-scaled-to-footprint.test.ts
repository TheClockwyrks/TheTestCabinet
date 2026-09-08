// Spectra — presentation/drone-scaled-to-footprint: each drone is drawn at its
// footprint.
//
// `specs/assets.md`: each entity is "scaled to that entity's footprint:
// `SHIP_W` by `SHIP_H` for the ship, `SHARD_SIZE` for a Shard, `FLUX_SIZE` for a
// Flux, `PRISM_SIZE` for a Prism with its shell intact". `specs/drones.md`
// repeats each figure beside the contact half-extent it goes with, which is what
// makes this worth grading rather than leaving to the eye: a drone drawn much
// larger or much smaller than it is hit at is a drone a player aims at wrongly.
//
// SO THE READING IS THE DESTINATION BOX, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` the frame issued is captured with the box it drew into, in logical
// stage units, and the box drawn for each drone is held against that drone's own
// figure. The pixels would not do: `specs/assets.md` lets a build lay a glow of
// its own around a body, and the lit patch a glow leaves is wider than the
// footprint by however much the build chose — a figure the specification does not
// fix and this point must not demand.
//
// WHICH DRAW IS THE DRONE'S. A build is free to blit a halo, a shadow or a
// pre-rendered glow beside the body, so the draw this point is about is the one
// whose source looks most like the drone's own seeded sprite, among the draws
// centred within that drone's footprint. Whether that source really is the seeded
// art is the four `*-from-sprite` points' question and is not asked again here.
//
// THE THREE ARE POSED IN ONE FRAME, side by side and far enough apart that no
// draw can be attributed to the wrong drone, each as a prop with every faculty
// off, and the Prism with its shell standing — `PRISM_SIZE` is the whole Prism's
// figure, and `PRISM_CORE_SIZE` belongs to a Prism whose shell has broken, which
// is `presentation/prism-core-alone`'s subject.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, fail } from "../assert";
import {
  FLUX_HOLD_L1,
  FLUX_SIZE,
  PRISM_SIZE,
  SHARD_SIZE,
  SPRITE_SIZE,
} from "../constants";
import {
  blitsNear,
  blitsOfFrame,
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type DroneKind,
  type Harness,
} from "../harness";
import { bestBlit, describeBlits } from "./reading";

/**
 * How far the drawn box may stand from the drone's own footprint, as a fraction
 * of it.
 *
 * The figure this item is written against: within 15%, so a `SHARD_SIZE` (`28`)
 * drone may be drawn between `23.8` and `32.2` units across. Wide enough for a
 * build that insets a sprite's transparent border or rounds a box to whole
 * device pixels, and far too narrow for a build that drew every drone at one
 * size or scaled the seeded `SPRITE_SIZE` (`64`) canvas straight onto the field.
 */
const SCALE_TOLERANCE = 0.15;

/** The row the three stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 420;

/**
 * The three drones, each at its own figure, `380` units apart — more than six
 * whole Prisms — so no glow, halo or accent a build lays around one can reach
 * another and every draw is unambiguously its own.
 */
const POSED: readonly { kind: DroneKind; size: number; x: number }[] = [
  { kind: "shard", size: SHARD_SIZE, x: 260 },
  { kind: "flux", size: FLUX_SIZE, x: 640 },
  { kind: "prism", size: PRISM_SIZE, x: 1020 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws each drone into a box the size of its own footprint", async () => {
  await startPosed(h);
  const ids: number[] = [];
  for (const { kind, x } of POSED) {
    ids.push(
      await poseDrone(h, kind, x, ROW_Y, {
        band: "cyan",
        // Mid-hold, so the Flux is the settled body `FLUX_SIZE` is stated for
        // rather than a shimmer (specs/drones.md). A band clock belongs to a Flux
        // and a shell to a Prism, and posing either on another kind fails loudly
        // (specs/instrumentation.md), so each is posed on its own kind alone.
        bandClock: kind === "flux" ? FLUX_HOLD_L1 / 2 : undefined,
        shell: kind === "prism" ? true : undefined,
      }),
    );
  }

  const blits = await blitsOfFrame(h);
  const snapshot = await h.snapshot();

  // The three drones at their footprints.
  await captureStill(h, "footprints");

  for (const [index, { kind, size }] of POSED.entries()) {
    const drone = requireDrone(snapshot, ids[index], `the posed ${kind}`);
    const at = { x: drone.x, y: drone.y };
    // Half its own footprint: a box whose centre left the drone is drawn
    // somewhere other than on it (specs/assets.md: centred on its position).
    const near = blitsNear(blits, at, size / 2);
    const drawn = bestBlit(near, kind);
    if (drawn === undefined) {
      fail(
        `a bitmap blitted within ${size / 2} units of the ${kind}'s centre at ` +
          `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) (specs/assets.md: each ` +
          `entity is drawn from its own sprite, centred on its position and ` +
          `scaled to its footprint)`,
        describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
      );
    }
    const low = size * (1 - SCALE_TOLERANCE);
    const high = size * (1 + SCALE_TOLERANCE);
    const where =
      `the ${kind} drawn ${size} units across, within ` +
      `${SCALE_TOLERANCE * 100}% (specs/assets.md and specs/drones.md)`;
    assertBetween(drawn.width, low, high, `${where}: the box's width`);
    assertBetween(drawn.height, low, high, `${where}: the box's height`);
  }
});
