// Spectra — instrumentation/deterministic-core: the simulation advances on the
// elapsed time it is handed and on nothing else, so one second of game time
// reaches the same state however that second was divided into frames.
//
// `specs/simulation.md` fixes the division exactly: "An update covering `dt`
// seconds is divided into `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of
// `h = dt / n` seconds each", and draws the conclusion itself — "One second of
// game time therefore covers the same ground whether it arrives as one frame, as
// sixty, or as a hundred and twenty: each runs a hundred and twenty sub-steps of
// `1/120` of a second." `specs/instrumentation.md` says the same thing of the
// clock operation this engine alone carries: "`advance(1, 1)` and `advance(1, 60)`
// cover the same second of game time and reach the same state."
//
// SO THE SAME SECOND IS SPENT THREE TIMES, AT DIVISIONS A HUNDRED AND TWENTY
// APART. `advance(1, 1)`, `advance(1, 60)` and `advance(1, 120)`, each on its own
// page, over the same posed field — and the three snapshots are held to being the
// same snapshot, field for field.
//
// THE FIELD IS POSED SO THAT A BUILD THAT SKIPPED THE DIVISION READS DIFFERENTLY.
// Three things on it can only agree across the three divisions if the frame really
// was divided:
//
//   - A DIVING DRONE, whose path bends toward the ship's `x` (`specs/swarm.md`).
//     A curve integrated as one step of a whole second lands somewhere a curve
//     integrated as a hundred and twenty sub-steps does not.
//   - A SHOT IN FLIGHT UNDER A DRONE. At `PLAYER_BULLET_SPEED` (`760`) a bullet
//     covers `760` units in the second below — three times the distance to its
//     target — so a build that advances a whole frame at once carries it clean
//     past the Shard without ever testing the contact, while a build that resolves
//     contacts at the end of each sub-step (`specs/simulation.md`) destroys the
//     Shard. That is the sharpest reading here: the two models differ by a drone.
//   - A FLUX'S BAND CLOCK, posed `0.1` s short of the end of its window, so the
//     window turns over inside the second and the remainder is carried into the
//     next one (`specs/drones.md`).
//
// AND THE FIELD IS READ FOR HAVING MOVED AT ALL, so "the same snapshot" is a
// reading rather than a statement about a field that never changed.
//
// `simTime` IS COMPARED APART FROM THE REST, and only to nine decimal digits.
// `specs/simulation.md` has each sub-step add its own `h` to it, and a hundred and
// twenty of those sum to a second to within the last bits of a double however they
// were grouped; half a nanosecond is that arithmetic, not room for a different
// reading of the rule. A build running a clock of its own, or dropping a frame's
// delta, misses by whole hundredths.
//
// WHAT THIS DOES NOT DECIDE. Not `SUBSTEP_MAX` itself: nothing here reads how far
// a single sub-step carried anything, only that the three divisions agree. Not the
// dive's speed or its shape, which are `swarm/dive-speed` and
// `swarm/dive-bends-toward-player`, and not the contact rule, which is
// `bands/match-destroys`.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertNotEqual,
  fail,
} from "../assert";
import { FLUX_SHIMMER, fluxWindow } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The span of game time each run covers, in seconds. */
const SPAN_SECONDS = 1;

/** The three divisions of that second: one frame, sixty, and a hundred and twenty. */
const DIVISIONS = [1, 60, 120] as const;

/** The stage every run is posed at, whose figures the Flux's window is read at. */
const STAGE = 1;

/** Where the diving drone starts, on the far side of the field from the shot. */
const DIVER_AT = { x: 1000, y: 200 } as const;

/** Where the Shard the shot is aimed at stands, and where the shot starts. */
const TARGET_AT = { x: 200, y: 200 } as const;
const SHOT_Y = 640;

/** Where the Flux holds its slot, and where an enemy bullet falls. */
const FLUX_AT = { x: 1150, y: 250 } as const;
const ENEMY_AT = { x: 350, y: 100 } as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `FLUX_SHIMMER` (`0.4` s) short of `fluxWindow(1)` (`2.0` s), so the window turns
 * over well inside the second below and the Flux is read on the other side of a
 * flip with a remainder carried into the next window (`specs/drones.md`).
 */
const BAND_CLOCK = fluxWindow(STAGE) - FLUX_SHIMMER;

/**
 * How far the accumulated `simTime` may sit from the second it was given, in
 * decimal digits for `assertCloseTo`.
 *
 * Nine, which is half a nanosecond. A conforming build accumulates exactly the
 * sub-steps it ran and the only distance from `1.0` is the sum of a hundred and
 * twenty doubles — this is that arithmetic, not room for a different reading of
 * the rule.
 */
const SIM_DIGITS = 9;

/** One run of the same second, at one of the three divisions. */
interface Run {
  h: Harness;
  frames: number;
  snapshot: SpectraSnapshot;
  /** The diving drone's centre, as `"x,y"`, or what was reported instead. */
  diver: string;
  /** The Flux's stored band, or what was reported instead. */
  fluxBand: string;
}

const open: Harness[] = [];

afterEach(async () => {
  for (const h of open.splice(0)) await h.dispose();
});

/** Pose the field and spend `SPAN_SECONDS` of game time on it in `frames` frames. */
async function spendTheSecond(frames: number): Promise<Run> {
  // `createHarness` takes the game off the wall clock and resets it, so every run
  // starts from the same seed and from `simTime` at zero.
  const h = await createHarness();
  open.push(h);
  await startPosed(h, { stage: STAGE });

  const diver = await poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
  });
  const flux = await poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "cyan",
    bandClock: BAND_CLOCK,
    oscillation: true,
  });
  await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, { band: "cyan" });
  await h.debug.addPlayerBullet(TARGET_AT.x, SHOT_Y, "cyan");
  await h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");

  // The one call the whole point is about: one second of game time, in `frames`
  // whole frames of `1 / frames` seconds each.
  await h.skip(SPAN_SECONDS, frames);

  const snapshot = await h.snapshot();
  const moved = snapshot.drones.find((drone) => drone.id === diver);
  const held = snapshot.drones.find((drone) => drone.id === flux);
  return {
    h,
    frames,
    snapshot,
    diver:
      moved === undefined
        ? `no drone carrying id ${diver}`
        : `${moved.x},${moved.y}`,
    fluxBand: held === undefined ? `no drone carrying id ${flux}` : held.band,
  };
}

/** The snapshot with `simTime` set aside, which is compared on its own. */
function field(run: Run): SpectraSnapshot {
  return { ...run.snapshot, simTime: 0 };
}

it("reaches the same state whether a second is one frame, sixty or a hundred and twenty", async () => {
  const runs: Run[] = [];
  for (const frames of DIVISIONS) runs.push(await spendTheSecond(frames));
  const [coarse, ...rest] = runs;
  if (coarse === undefined) fail("three runs of the same second", "none");
  // Before the assertions, so a failure still leaves the picture of the field the
  // most finely divided second reached.
  await captureStill(runs[runs.length - 1].h, "stepped");

  // The field really moved, so "the same snapshot" is a reading rather than a
  // tautology about a field that stood still.
  assertNotEqual(
    coarse.diver,
    `${DIVER_AT.x},${DIVER_AT.y}`,
    `the diving drone's centre after ${SPAN_SECONDS} s of game time, which is ` +
      `where it was posed — a dive travels at DIVE_SPEED (300) units per ` +
      `second (specs/swarm.md), so a second carries it well off that point`,
  );
  assertNotEqual(
    coarse.fluxBand,
    "cyan",
    `the Flux's stored band after ${SPAN_SECONDS} s of game time, from the ` +
      `cyan it was posed with ${BAND_CLOCK} s into a fluxWindow(${STAGE}) of ` +
      `${fluxWindow(STAGE)} s — the window turns over inside the second and ` +
      `the stored band flips with it (specs/drones.md)`,
  );

  for (const run of runs) {
    assertCloseTo(
      run.snapshot.simTime,
      SPAN_SECONDS,
      SIM_DIGITS,
      `the simulation time ${run.frames} frame(s) worth ` +
        `${SPAN_SECONDS / run.frames} s each accumulated`,
    );
  }

  for (const run of rest) {
    assertDeepEqual(
      field(run),
      field(coarse),
      `the whole state ${SPAN_SECONDS} s of game time reached as ${run.frames} ` +
        `frame(s), against the state the same second reached as ` +
        `${coarse.frames} — every frame divides into whole sub-steps of at ` +
        `most SUBSTEP_MAX, so all three run the same hundred and twenty ` +
        `sub-steps of 1/120 s (specs/simulation.md)`,
    );
  }
});
