// tape/controller-brakes — a commanded axis brakes at its own acceleration, from
// the tick the braking test first holds.
//
// specs/program.md § Axis motion, step 1: "if `v * s > 0` and
// `|d| <= v * v / (2 * a)`, brake, `v = v - s * a * dt`", with `d = T - x` and
// `s = sign(d)` read at the TOP of the tick. So the rate a braking tick leaves is
// the rate it found less `s * a * dt`, and the tick that first brakes is the
// first whose remaining distance has fallen to the stopping distance the rule
// names.
//
// THE WHOLE MOVE IS SAMPLED AND EVERY BRAKING TICK IS HELD TO THE RULE, rather
// than one tick chosen in advance: the tick braking starts on is itself part of
// the requirement, and it is decided here from the axis state the previous tick
// left — the same reading the controller makes — rather than from a tick number
// this file guessed. Every tick the rule calls braking is then held to a rate
// exactly `TROLLEY_ACCEL / TICK_HZ` below the one before it. The tick the axis
// arrives on is left out: arrival sets the rate to `0` whatever the tick did on
// the way in (step 3), and that is another item's requirement.
//
// The trolley is the axis, and the minimal crane's track is `4` units long, so a
// target of `3.5` at the trolley's max rate accelerates for a while, brakes for
// about a second, and arrives — with the target inside the track's range at the
// step's start, so nothing is refused. The yard is emptied: the controller reads
// the axis alone, and a load on the hook would only change what the axis drives
// against.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear } from "../assert";
import { TICK_HZ, TROLLEY_ACCEL, TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Inside the minimal crane's four-unit track, and far enough to cruise. */
const TARGET = 3.5;

/** What a braking tick takes off the rate. */
const STEP = TROLLEY_ACCEL / TICK_HZ;

/** Longer than the move: it accelerates, cruises, brakes and arrives well inside. */
const TICKS = 4 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a * dt off the rate on every tick the braking rule calls for", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "trolley", target: TARGET, rate: TROLLEY_MAX_RATE }],
    },
  ]);
  const started = await startRun(h);

  const samples = [started.run.axes.trolley];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const state = await runTicks(h, 1);
    samples.push(state.run.axes.trolley);
    if (state.run.phase !== "running") break;
  }

  await h.capture("state", "The trolley at the end of a braked move");

  let braked = 0;
  for (let tick = 1; tick < samples.length; tick += 1) {
    const was = samples[tick - 1]!;
    const now = samples[tick]!;
    // The rule, read from the state at the TOP of this tick.
    const d = TARGET - was.value;
    const s = Math.sign(d);
    const brakes =
      was.rate * s > 0 &&
      Math.abs(d) <= (was.rate * was.rate) / (2 * TROLLEY_ACCEL);
    // The tick the axis arrived on sets the rate to 0 whatever it did on the
    // way in, so it is not a reading of the braking term.
    if (!brakes || now.command === null) continue;
    braked += 1;
    assertNear(
      now.rate,
      was.rate - s * STEP,
      1e-9,
      `the trolley's rate after tick ${tick}, which found ${Math.abs(d).toFixed(4)} ` +
        `left to go at ${was.rate.toFixed(4)} u/s — at most the ` +
        `v * v / (2 * a) the brake rule names — so the tick takes ` +
        `TROLLEY_ACCEL / TICK_HZ (${STEP}) off it (specs/program.md)`,
    );
  }

  assertGreaterThan(
    braked,
    0,
    "the ticks of the move the brake rule called for, without which the rule " +
      "was never exercised (specs/program.md)",
  );
});
