// instrumentation/deterministic-core — the simulation advances on the elapsed time
// it is handed and on nothing else, so one second of game time reaches the same
// state however that second was divided into frames.
//
// specs/simulation.md fixes the division exactly: "An update covering `dt` seconds
// is divided into `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`
// seconds each", and draws the conclusion itself — "One second of game time
// therefore covers the same ground whether it arrives as one frame, as sixty, or
// as a hundred and twenty: each runs a hundred and twenty sub-steps of `1/120` of
// a second." specs/instrumentation.md rests the whole surface on it: "every frame
// resolves in whole `SUBSTEP_MAX` sub-steps".
//
// THE SAME SECOND IS SPENT THREE TIMES, AT DIVISIONS A HUNDRED AND TWENTY APART.
// Under this engine the clock is the ENGINE's, so each run is a harness of its own
// built over a `ConstantClock` handing out one, a sixtieth, or a hundred and
// twentieth of a second per frame — and each is then advanced exactly the frames
// that cover the second. The three snapshots are held to being the same snapshot,
// field for field.
//
// THE FIELD IS POSED SO THAT A BUILD THAT SKIPPED THE DIVISION READS DIFFERENTLY.
// Three things on it can only agree across the three divisions if the frame really
// was divided:
//
//   - A DIVING DRONE, whose path bends toward the ship's `x` (specs/swarm.md). A
//     curve integrated as one step of a whole second lands somewhere a curve
//     integrated as a hundred and twenty sub-steps does not.
//   - A SHOT IN FLIGHT UNDER A SHARD. At `PLAYER_BULLET_SPEED` (`760`) a bullet
//     covers `760` units in the second below — well past its target — so a build
//     that advances a whole frame at once carries it clean past the Shard without
//     ever testing the contact, while a build that resolves contacts at the end of
//     each sub-step (specs/simulation.md) destroys the Shard. That is the sharpest
//     reading here: the two models differ by a drone.
//   - A FLUX'S BAND CLOCK, posed inside the held part of its window so that the
//     window turns over inside the second and the remainder is carried into the
//     next one (specs/drones.md).
//
// AND THE FIELD IS READ FOR HAVING MOVED AT ALL, so "the same snapshot" is a
// reading rather than a statement about a field that never changed.
//
// TWO ENTRIES ARE COMPARED APART FROM THE REST, and each for its own reason.
// `simTime` is held to the second to nine decimal digits: specs/simulation.md has
// each sub-step add its own `h` to it, and a hundred and twenty of those sum to a
// second to within the last bits of a double however they were grouped; half a
// nanosecond is that arithmetic, not room for a different reading of the rule, and
// a build running a clock of its own misses by whole hundredths. A burst's
// `particles` is set aside altogether: it is "the count the burst's own particle
// simulation holds at the call" (specs/instrumentation.md), and that simulation
// belongs to the drone-burst system specs/assets.md has the build play rather than
// to the game's own sub-stepped world, so nothing in the specification says how it
// divides a frame. Everything else — every drone, every bullet, the whole run, and
// each burst's id, centre, footprint and elapsed time — is compared entry for
// entry.
//
// WHAT THIS DOES NOT DECIDE. Not `SUBSTEP_MAX` itself: nothing here reads how far
// a single sub-step carried anything, only that the three divisions agree. Not the
// dive's speed or its shape, which are `swarm/dive-speed` and
// `swarm/dive-bends-toward-player`, and not the contact rule, which is
// `bands/match-destroys`.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, it } from "vitest";
import { FLUX_SHIMMER, fluxHold, fluxWindow } from "../constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertNotEqual,
  fail,
} from "../assert";
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

/** Where the Flux holds its place, and where an enemy bullet falls. */
const FLUX_AT = { x: 1150, y: 250 } as const;
const ENEMY_AT = { x: 350, y: 100 } as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `1.5`, which is inside the held part of a stage-1 window (`fluxHold(1)` is
 * `1.6` s) and half a second short of the window's end (`fluxWindow(1)` is
 * `2.0` s) — so the window turns over well inside the second below and the Flux is
 * read on the other side of a flip, with a remainder carried into the next window
 * (specs/drones.md).
 */
const BAND_CLOCK = 1.5;

/**
 * How far the accumulated `simTime` may sit from the second it was given, in
 * decimal digits for `assertCloseTo`.
 *
 * Nine, which is half a nanosecond. A conforming build accumulates exactly the
 * sub-steps it ran, and the only distance from `1.0` is the sum of a hundred and
 * twenty doubles.
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

afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

/** Pose the field and spend `SPAN_SECONDS` of game time on it in `frames` frames. */
async function spendTheSecond(frames: number): Promise<Run> {
  // A clock of this run's own, so one frame of it is exactly `1 / frames` of the
  // second — the engine hands the game whatever elapsed time a frame took, and
  // that is the only thing this point varies.
  const h = await createHarness({
    clock: new ConstantClock((SPAN_SECONDS * 1000) / frames),
  });
  open.push(h);
  startPosed(h);

  const diver = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
  });
  const flux = poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "cyan",
    bandClock: BAND_CLOCK,
    oscillation: true,
  });
  poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, { band: "cyan" });
  h.debug.addPlayerBullet(TARGET_AT.x, SHOT_Y, "cyan");
  h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");

  // The one drive the whole point is about: one second of game time, as `frames`
  // whole frames of `1 / frames` seconds each.
  await h.advance(frames);

  const snapshot = h.snapshot();
  const moved = snapshot.drones.find((drone) => drone.id === diver);
  const held = snapshot.drones.find((drone) => drone.id === flux);
  return {
    h,
    frames,
    snapshot,
    diver:
      moved === undefined
        ? `no drone carrying id ${String(diver)}`
        : `${String(moved.x)},${String(moved.y)}`,
    fluxBand:
      held === undefined ? `no drone carrying id ${String(flux)}` : held.band,
  };
}

/**
 * The snapshot with the two entries the specification does not fix across a
 * division set aside: `simTime`, compared on its own, and each burst's particle
 * count, which is the drone-burst system's rather than the game's.
 */
function field(run: Run): SpectraSnapshot {
  return {
    ...run.snapshot,
    simTime: 0,
    bursts: run.snapshot.bursts.map((burst) => ({ ...burst, particles: 0 })),
  };
}

it("reaches the same state whether a second is one frame, sixty or a hundred and twenty", async () => {
  const runs: Run[] = [];
  for (const frames of DIVISIONS) runs.push(await spendTheSecond(frames));
  const coarse = runs[0];
  if (coarse === undefined) fail("three runs of the same second", "none");
  // Before the assertions, so a failure still leaves the picture of the field the
  // most finely divided second reached.
  captureStill(runs[runs.length - 1].h, "stepped");

  // The field really moved, so "the same snapshot" is a reading rather than a
  // tautology about a field that stood still.
  assertNotEqual(
    coarse.diver,
    `${String(DIVER_AT.x)},${String(DIVER_AT.y)}`,
    `the diving drone's centre after ${String(SPAN_SECONDS)} s of game time, ` +
      "which is where it was posed — a dive travels at DIVE_SPEED (300) units " +
      "per second (specs/swarm.md), so a second carries it well off that point",
  );
  assertNotEqual(
    coarse.fluxBand,
    "cyan",
    `the Flux's stored band after ${String(SPAN_SECONDS)} s of game time, ` +
      `from the cyan it was posed with ${String(BAND_CLOCK)} s into a ` +
      `fluxWindow(${String(STAGE)}) of ${String(fluxWindow(STAGE))} s, whose ` +
      `held part is fluxHold(${String(STAGE)}) = ${String(fluxHold(STAGE))} s ` +
      `and whose shimmer is FLUX_SHIMMER (${String(FLUX_SHIMMER)} s) — the ` +
      "window turns over inside the second and the stored band flips with it " +
      "(specs/drones.md)",
  );

  for (const run of runs) {
    assertCloseTo(
      run.snapshot.simTime,
      SPAN_SECONDS,
      SIM_DIGITS,
      `the simulation time ${String(run.frames)} frame(s) worth ` +
        `${String(SPAN_SECONDS / run.frames)} s each accumulated`,
    );
  }

  for (const run of runs.slice(1)) {
    assertDeepEqual(
      field(run),
      field(coarse),
      `the whole state ${String(SPAN_SECONDS)} s of game time reached as ` +
        `${String(run.frames)} frame(s), against the state the same second ` +
        `reached as ${String(coarse.frames)} — every frame divides into whole ` +
        "sub-steps of at most SUBSTEP_MAX, so all three run the same hundred " +
        "and twenty sub-steps of 1/120 s (specs/simulation.md)",
    );
  }
});
