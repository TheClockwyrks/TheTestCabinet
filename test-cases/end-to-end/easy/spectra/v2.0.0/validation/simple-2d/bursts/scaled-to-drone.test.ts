// Spectra — bursts/scaled-to-drone: the burst is scaled to the drone.
//
// `specs/assets.md`, the drone-burst's "How large" rule: "The system's
// `BURST_FIELD` square is scaled to the popped drone's own footprint, so a
// Prism's burst is larger than a Shard's." `specs/instrumentation.md` reports
// that figure per live burst, as `size`: "the footprint the effect is played
// at". `specs/assets.md` fixes the two footprints the rule names — `SHARD_SIZE`
// (`28`) for a Shard, and `PRISM_SIZE` (`56`) for a Prism with its shell intact.
//
// TWO POPS OF DIFFERENT SIZE, IN ONE FIELD. A Prism's shell is broken by a shot
// of the shell's band and a Shard is destroyed by a shot of its own, and each
// pop is read for the footprint the build played it at. Both readings are needed
// and neither alone is enough: a build that plays every burst at one fixed size
// satisfies whichever of the two that size happens to sit near, and fails the
// other; a build that scales the field to the drone satisfies both. The
// comparison between them — the Prism's larger than the Shard's — is the
// specification's own sentence, and it is asserted as well, because a build that
// scaled the two the wrong way round could in principle sit inside both bands.
//
// WHY THE PRISM IS READ AT ITS SHELL BREAK. `specs/assets.md` starts a burst
// when a Prism's shell breaks as surely as when a drone is destroyed, and a
// Prism with its shell intact is drawn at `PRISM_SIZE` while a Prism with only
// its core left is drawn at `PRISM_CORE_SIZE` (`26`) — which is SMALLER than a
// Shard. The specification's "a Prism's burst is larger than a Shard's" is
// therefore about the Prism carrying its shell, and that is the pop read here.
// That a Prism pops twice at all is `bursts/prism-twice`.
//
// WHAT THIS DOES NOT DECIDE. Where a burst stands is `bursts/spawns-on-kill`,
// and what it paints is `bursts/drawn`. Nothing here reads a pixel: the figure
// under test is one the surface reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { PRISM_SIZE, SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { burstOf } from "./reading";
import { firedPop } from "./scene";

/**
 * How far a burst's reported footprint may stand from the footprint of the drone
 * that popped, as a fraction.
 *
 * A quarter. `specs/assets.md` fixes the scaling as a rule rather than as a
 * formula with a rounding, and it leaves a build free to fit the system's square
 * field to the drone's box with a little margin either way — the particles of
 * the ring reach past the field's own edge, so a build that padded the square
 * slightly is playing the same effect at the same drone. A quarter of
 * `SHARD_SIZE` is `7` units and a quarter of `PRISM_SIZE` is `14`, and the two
 * bands they open — `21` to `35`, and `42` to `70` — do not touch, so no single
 * fixed size satisfies both and `PRISM_CORE_SIZE` (`26`) does not pass for a
 * shell-intact Prism.
 */
const SIZE_TOLERANCE = 0.25;

/**
 * Where the two drones are posed: a clear stretch of the play field, below the
 * formation grid and its full sway, above the ship's lane, far enough apart that
 * neither shot can reach the other drone.
 */
const PRISM_AT = { x: 400, y: 460 } as const;
const SHARD_AT = { x: 1000, y: 460 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays a Prism's burst at its footprint and a Shard's at its own", async () => {
  startPosed(h);
  // Both are given the cyan `addDrone` lays a drone down with, so a cyan shot
  // matches the Prism's shell and the Shard alike (specs/bands.md).
  const prism = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    shell: true,
  });
  poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, { band: "cyan" });

  const broke = await firedPop(h, PRISM_AT.x, PRISM_AT.y, "cyan");
  assertEqual(
    droneOf(h.snapshot(), prism).shellAlive,
    false,
    "precondition: the cyan shot broke the cyan shell (specs/drones.md)",
  );

  const popped = await firedPop(h, SHARD_AT.x, SHARD_AT.y, "cyan");

  // The Prism's burst beside the Shard's, both still playing.
  captureStill(h, "pair");

  const playing = h.snapshot();
  const prismBurst = burstOf(
    playing,
    broke.id,
    "the burst the Prism's shell break started",
  );
  const shardBurst = burstOf(
    playing,
    popped.id,
    "the burst the Shard's destruction started",
  );

  assertBetween(
    prismBurst.size,
    PRISM_SIZE * (1 - SIZE_TOLERANCE),
    PRISM_SIZE * (1 + SIZE_TOLERANCE),
    `the footprint the Prism's burst is played at, against the PRISM_SIZE ` +
      `(${PRISM_SIZE}) a shell-intact Prism is drawn at (specs/assets.md: the ` +
      `system's square field is scaled to the popped drone's own footprint)`,
  );
  assertBetween(
    shardBurst.size,
    SHARD_SIZE * (1 - SIZE_TOLERANCE),
    SHARD_SIZE * (1 + SIZE_TOLERANCE),
    `the footprint the Shard's burst is played at, against the SHARD_SIZE ` +
      `(${SHARD_SIZE}) a Shard is drawn at (specs/assets.md)`,
  );
  assertGreaterThan(
    prismBurst.size,
    shardBurst.size,
    `the Prism's burst played larger than the Shard's (specs/assets.md: so a ` +
      `Prism's burst is larger than a Shard's); the Shard's was played at ` +
      `${shardBurst.size}`,
  );
});
