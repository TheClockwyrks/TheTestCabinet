// tape/controller-cruises-at-the-commanded-rate — the drive term is clamped to
// the command's own rate, so an axis commanded below its max cruises there.
//
// specs/program.md § Axis motion, step 1: "otherwise drive, `v = v + s * a * dt`
// clamped to `[-r, +r]`", with `r` the commanded rate. The axis's max rate is
// what the EDITOR holds a command to (§ The tape); what the controller clamps to
// is the rate the command carries. So a slew commanded at `10` deg/s settles at
// exactly `10` and never reaches `SLEW_MAX_RATE` (`30`).
//
// EVERY TICK OF THE CLIMB IS READ, not just the settled rate, because the
// requirement has two halves that one reading cannot separate: the rate settles
// AT the commanded figure, and it never passes it on the way. A build that
// clamped to the axis's max instead would keep accelerating past `10`, and one
// that clamped a tick late would overshoot for a tick and come back.
//
// The target is `180` degrees at `10` deg/s: the slew is unbounded
// (§ The axes), so nothing about the target is refused, and the distance is far
// past the `v * v / (2 * a)` (`1.67` degrees) the brake rule needs, so every tick
// sampled here is a drive or a cruise rather than a brake. The climb takes twenty
// ticks (`10 / (SLEW_ACCEL / TICK_HZ)`), and the sampling runs five ticks past it:
// the clamp is decided on the tick the rate first reaches the command, and the
// ticks after it say the axis cruises there rather than climbing on.
//
// The yard is emptied: the clamp is the controller's arithmetic and reads
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual, assertNear } from "../assert";
import { SLEW_ACCEL, SLEW_MAX_RATE, TICK_HZ } from "../constants";
import {
  createHarness,
  openSite,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Below the slew's max rate, and what the command carries. */
const RATE = 10;

/** Far enough that the move is still cruising when the sampling ends. */
const TARGET = 180;

/** The ticks the climb to the commanded rate takes, and five of cruise past it. */
const CLIMB = Math.ceil(RATE / (SLEW_ACCEL / TICK_HZ));
const TICKS = CLIMB + 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("settles a commanded axis at the command's rate and never above it", async () => {
  await openSite(h, 0);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await standMinimalCrane(h);
  // The tape poses apply on the tape editor's own screen
  // (specs/instrumentation.md), and `startRun` poses the `run` action, which the
  // program screen carries as well as the build screen.
  await h.debug.setScreen("program");
  await h.debug.addMoveStep("slew", TARGET, RATE);
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run drives the commanded slew",
  );

  const rates: number[] = [];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    rates.push((await runTicks(h, 1)).run.axes.slew.rate);
  }

  await h.capture("state", "The slew cruising at its commanded rate");

  for (const [index, rate] of rates.entries()) {
    assertLessThanOrEqual(
      rate,
      RATE + 1e-9,
      `the slew's rate after tick ${index + 1}, which the drive term clamps ` +
        `to the commanded ${RATE} rather than to SLEW_MAX_RATE ` +
        `(${SLEW_MAX_RATE}) (specs/program.md)`,
    );
  }
  assertNear(
    rates[rates.length - 1] ?? 0,
    RATE,
    1e-9,
    `the slew's rate after ${TICKS} ticks, five past the ${CLIMB} the climb ` +
      "to the commanded rate takes, so the axis is cruising " +
      "(specs/program.md)",
  );
});
