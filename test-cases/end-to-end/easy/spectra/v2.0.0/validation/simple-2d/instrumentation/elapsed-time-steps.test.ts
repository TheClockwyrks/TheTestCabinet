// instrumentation/elapsed-time-steps — the simulation advances on the elapsed
// time it is handed and on nothing else, so one second of game time resolves the
// same rules however that second was divided into frames.
//
// specs/simulation.md fixes the division exactly: "An update covering `dt` seconds
// is divided into `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`
// seconds each", and draws the conclusion itself — "One second of game time
// therefore covers the same ground whether it arrives as one frame, as sixty, or
// as a hundred and twenty: each runs a hundred and twenty sub-steps of `1/120` of
// a second." specs/instrumentation.md rests the whole surface on it: "every frame
// resolves in whole `SUBSTEP_MAX` sub-steps".
//
// SO THE SAME SECOND IS SPENT THREE TIMES, AT DIVISIONS A HUNDRED AND TWENTY
// APART, and each run is held to the figures the specification states for that
// second. Under this engine the clock is the ENGINE's, so each run is a
// harness of its own built over a `ConstantClock` handing out one, a sixtieth, or a
// hundred and twentieth of a second per frame — and each is then advanced exactly
// the frames that cover the second.
//
// THE FIELD IS POSED SO THAT A BUILD THAT SKIPPED THE DIVISION READS DIFFERENTLY,
// and every figure read off it is one the specification fixes exactly:
//
//   - A SHOT IN FLIGHT UNDER A SHARD. At `PLAYER_BULLET_SPEED` (`760`) a bullet
//     covers `760` units in the second below — well past the `440` to its target —
//     so a build that advances a whole frame at once carries it clean past the
//     Shard without ever testing the contact, while a build that resolves contacts
//     at the end of each sub-step (specs/simulation.md) destroys the Shard and
//     consumes the shot. That is the sharpest reading here: the two models differ
//     by a drone.
//   - A FLUX'S BAND CLOCK, posed `FLUX_SHIMMER` short of the end of its window, so
//     the window turns over inside the second: the stored band flips and the clock
//     carries the remainder into the next window (specs/drones.md), which fixes
//     both the band and the clock the second ends on.
//   - AN ENEMY BULLET, which falls exactly `ENEMY_BULLET_SPEED` times
//     `bulletSpeedScale(stage)` units over the second (specs/swarm.md).
//   - A DIVING DRONE, whose path is the build's own (specs/swarm.md), so it is read
//     for having moved at all: the second really ran, and "the same rules" is a
//     reading rather than a statement about a field that stood still.
//
// `simTime` is held to the second it was given: specs/simulation.md has each
// sub-step add its own `h` to it, and a hundred and twenty of those sum to a second
// to within the last bits of a double however they were grouped, so a build running
// a clock of its own, or dropping a frame's delta, misses by whole hundredths.
//
// EACH FIGURE THE SIMULATION INTEGRATES IS READ WITHIN A TOLERANCE, and the
// tolerances are the rounding a hundred and twenty sub-steps can carry, not room
// for a different reading of the rule. No two runs are compared with each other:
// the shot's burst scatters at random (specs/assets.md), so what one run left on
// the field is not what another left, and the rules are what every run shares.
//
// WHAT THIS DOES NOT DECIDE. Not `SUBSTEP_MAX` itself: nothing here reads how far a
// single sub-step carried anything, only that a second resolves the same rules at
// every division. Not the dive's speed or its shape, which are `swarm/dive-speed`
// and `swarm/dive-bends-toward-player`, and not the contact rule itself, which is
// `bands/match-destroys`.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNotEqual, fail } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  FLUX_SHIMMER,
  bulletSpeedScale,
  fluxWindow,
} from "../constants";
import {
  captureStill,
  createHarness,
  enemyBullets,
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

/** Where the Flux holds its slot, and where an enemy bullet falls from. */
const FLUX_AT = { x: 1150, y: 250 } as const;
const ENEMY_AT = { x: 350, y: 100 } as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `FLUX_SHIMMER` (`0.4` s) short of `fluxWindow(1)` (`2.0` s), so the window turns
 * over well inside the second below and the Flux is read on the other side of a
 * flip with a remainder carried into the next window (specs/drones.md).
 */
const BAND_CLOCK = fluxWindow(STAGE) - FLUX_SHIMMER;

/** The band clock the Flux ends the second on: the remainder past the turnover. */
const BAND_CLOCK_AFTER = BAND_CLOCK + SPAN_SECONDS - fluxWindow(STAGE);

/** Where the enemy bullet's centre is after the second, in logical units. */
const ENEMY_Y_AFTER =
  ENEMY_AT.y + ENEMY_BULLET_SPEED * bulletSpeedScale(STAGE) * SPAN_SECONDS;

/**
 * How far an integrated clock may sit from its figure, in seconds.
 *
 * A hundredth: a conforming build accumulates a hundred and twenty sub-steps of
 * `1/120` s and lands within the last bits of a double, and a build that lost or
 * doubled a single sub-step misses by nearly a hundredth on its own.
 */
const CLOCK_TOLERANCE = 0.01;

/**
 * How far an integrated position may sit from its figure, in logical units.
 *
 * Half a unit, against a second's travel of `320`: the rounding a hundred and
 * twenty sub-steps can carry is far inside it, and a build that skipped or doubled
 * a sub-step is `2.7` units out.
 */
const POSITION_TOLERANCE = 0.5;

/**
 * How far the accumulated `simTime` may sit from the second it was given, in
 * decimal digits for `assertCloseTo`.
 *
 * Six, which is half a microsecond: the sum of a hundred and twenty doubles lands
 * far inside it, and a build running a clock of its own misses by hundredths.
 */
const SIM_DIGITS = 6;

/** One run of the same second, at one of the three divisions. */
interface Run {
  h: Harness;
  frames: number;
  snapshot: SpectraSnapshot;
  diver: number;
  flux: number;
  target: number;
  enemy: number;
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
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
  });
  h.debug.addPlayerBullet(TARGET_AT.x, SHOT_Y, "cyan");
  h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");
  const enemy = enemyBullets(h.snapshot()).slice(-1)[0]?.id ?? -1;

  // The one drive the whole point is about: one second of game time, as `frames`
  // whole frames of `1 / frames` seconds each.
  await h.advance(frames);

  return { h, frames, snapshot: h.snapshot(), diver, flux, target, enemy };
}

/** Hold one run of the second to the figures the specification states for it. */
function assertTheSecond(run: Run): void {
  const division = `${String(run.frames)} frame(s) worth ${String(SPAN_SECONDS / run.frames)} s each`;
  const { snapshot } = run;

  assertCloseTo(
    snapshot.simTime,
    SPAN_SECONDS,
    SIM_DIGITS,
    `the simulation time ${division} accumulated (specs/simulation.md)`,
  );

  const moved = snapshot.drones.find((drone) => drone.id === run.diver);
  assertNotEqual(
    moved === undefined ? "gone" : `${String(moved.x)},${String(moved.y)}`,
    `${String(DIVER_AT.x)},${String(DIVER_AT.y)}`,
    `the diving drone's centre after ${String(SPAN_SECONDS)} s of game time as ` +
      `${division}, which is where it was posed — a dive travels at DIVE_SPEED ` +
      `(300) units per second (specs/swarm.md), so a second carries it well off ` +
      `that point`,
  );

  assertEqual(
    snapshot.drones.some((drone) => drone.id === run.target),
    false,
    `whether the Shard under the shot still stands after ${division} — the shot ` +
      `reaches it inside the second and a matching shot destroys it, resolved at ` +
      `the end of a sub-step (specs/simulation.md, specs/bands.md)`,
  );
  assertEqual(
    snapshot.bullets.some((bullet) => bullet.friendly),
    false,
    `whether the player's shot is still in flight after ${division} — a contact ` +
      `consumes the bullet (specs/simulation.md)`,
  );

  const held = snapshot.drones.find((drone) => drone.id === run.flux);
  assertEqual(
    held?.band,
    "magenta",
    `the Flux's stored band after ${division}, from the cyan it was posed with ` +
      `${String(BAND_CLOCK)} s into a fluxWindow(${String(STAGE)}) of ` +
      `${String(fluxWindow(STAGE))} s — the window turns over inside the second ` +
      `and the stored band flips with it (specs/drones.md)`,
  );
  assertCloseToWithin(
    held?.bandClock,
    BAND_CLOCK_AFTER,
    CLOCK_TOLERANCE,
    `the Flux's band clock after ${division} — the clock returns to 0 at the ` +
      `turnover and carries the rest of the second into the next window ` +
      `(specs/drones.md)`,
  );

  const falling = snapshot.bullets.find((bullet) => bullet.id === run.enemy);
  assertCloseToWithin(
    falling?.y,
    ENEMY_Y_AFTER,
    POSITION_TOLERANCE,
    `the enemy bullet's centre y after ${division} — it falls at ` +
      `ENEMY_BULLET_SPEED (320) times bulletSpeedScale(${String(STAGE)}) units ` +
      `per second (specs/swarm.md)`,
  );
}

/** `actual` within `tolerance` of `expected`, with a reading of what was found. */
function assertCloseToWithin(
  actual: number | undefined,
  expected: number,
  tolerance: number,
  what: string,
): void {
  if (actual === undefined || !(Math.abs(actual - expected) <= tolerance)) {
    fail(
      `${what}: within ${String(tolerance)} of ${String(expected)}`,
      actual === undefined ? "nothing reported" : actual,
    );
  }
}

it("resolves the same rules whether a second is one frame, sixty or a hundred and twenty", async () => {
  const runs: Run[] = [];
  for (const frames of DIVISIONS) runs.push(await spendTheSecond(frames));
  const last = runs[runs.length - 1];
  if (last === undefined) fail("three runs of the same second", "none");
  // Before the assertions, so a failure still leaves the picture of the field the
  // most finely divided second reached.
  await captureStill(last.h, "stepped");

  for (const run of runs) assertTheSecond(run);
});
