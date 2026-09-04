// bands/inversion-swaps-drone — an inversion swaps what a drone reads as.
//
// specs/bands.md defines effective band once — the stored band, taken as the
// opposite once for each swap that holds — and lists an active inversion as one
// of the three swaps, on a drone or an enemy bullet. So a stored-cyan drone under
// an inversion reads magenta.
//
// A SHARD is the drone posed, deliberately: it is the one kind with no swap of
// its own, since a Prism's shell and a Flux's shimmer are the other two, so the
// inversion is the only thing that can move the reading. The reading is taken as
// a pair — the stored band still cyan, the effective band magenta — because that
// pair is what says the inversion SWAPPED the reading rather than the build
// rewriting the drone's stored band, which specs/bands.md forbids in the same
// breath ("Nothing about the ship, the player's bullets, or any stored band
// changes"). A build that flipped the stored field instead would read cyan
// effective and fail here.
//
// The inversion is posed with `setInversion`, which specs/instrumentation.md
// gives for exactly this: the trigger that starts one is `drones`' item, and what
// a running one swaps is this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, INVERSION_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the drone stands: mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reads a stored-cyan drone as magenta while an inversion runs", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "shard", AT.x, AT.y, { band: "cyan" });
  await harness.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field rather than the one
  // before it. It costs the inversion 0.01 s of its 5.
  await harness.advance(1);

  const posed = await harness.snapshot();
  await captureStill(harness, "swapped");

  assertEqual(
    posed.inversionActive,
    true,
    "an inversion running over the posed drone",
  );
  const drone = requireDrone(
    posed,
    id,
    "the stored-cyan drone under an inversion",
  );
  assertEqual(
    drone.band,
    "cyan",
    "the drone's stored band, which an inversion never changes (specs/bands.md)",
  );
  assertEqual(
    drone.effectiveBand,
    "magenta",
    "the band a stored-cyan drone reads as under an inversion (specs/bands.md)",
  );
});
