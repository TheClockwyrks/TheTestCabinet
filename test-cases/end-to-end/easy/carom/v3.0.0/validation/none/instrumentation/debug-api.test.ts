// Carom — instrumentation/debug-api: the build installed its debug and automation
// surface on `window.__carom`, and that surface is whole, really backed by the
// state the build declared, and really in control of the game's clock.
//
// THREE HALVES, AND ALL OF THEM ARE THE BUILD'S. Under an engine the build
// writes the surface and returns it beside its state, and the engine is what
// holds it. Nothing holds it here: an engineless run gets no runtime at all, so
// the surface itself — every operation, the version, the snapshot shape — and the
// global it is installed on are deliverables of this point
// (specs/instrumentation.md).
//
// The first half is that it is THERE. A build that never installed the global
// leaves nothing for a check to reach the game through, and every other automated
// item in this suite fails with it; this one names the fault plainly, and the
// harness reports it as `surfaceFault` rather than by throwing so that it lands
// here rather than in some check's setup.
//
// The second is the state behind it. A surface whose operations are present and
// whose snapshot reports zeroes is present and useless, and that is what a
// snapshot read off a real, driven match catches.
//
// The third is the CLOCK, which exists only under this engine. Nothing outside an
// engineless build owns its loop, so `setAutoStep` and `advance` are on the
// surface and everything else in this suite rests on them: a build whose
// `setAutoStep(false)` does not really disconnect the wall clock, or whose
// `advance` does not really run whole frames, gives every other check a scenario
// that drifts under it. So this point checks both directly.
//
// The keyboard and the overlay are NOT on the surface. They belong to the runtime
// layer an engineless build writes, and `specs/instrumentation.md` strikes
// `keyDown`, `keyUp` and `press` from the operation list, so demanding them here
// would fail a perfectly conformant build. The control checks press real keys
// instead.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertNull,
} from "../assert";
import { FIELD_CY, HOLD_TIME } from "../constants";
import {
  ball0,
  captureStill,
  CAROM_DEBUG_VERSION,
  createHarness,
  failSurface,
  HANDLE,
  REQUIRED_OPS,
  startPlaying,
  type Harness,
} from "../harness";

/** Real time allowed to pass with the game off the clock and nothing advancing it. */
const FROZEN_MS = 750;

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * build owes, rather than with a comparison's rendering of it.
 *
 * `assertNull(h.surfaceFault)` would read as "Expected: null" over the reason,
 * which throws away the half of the pair that says what the build owes. This is
 * the point whose whole job is to name that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`installs its surface on window.${HANDLE}`, async () => {
  // There is no engine to have accepted it and no seeded module to have built it:
  // the build wrote the surface and put it on the page, and either it is there or
  // nothing in this directory can reach the game. `surfaceFault` is what the
  // harness found when it looked, and it names the missing piece.
  requireSurface();

  const { version } = await h.probe([]);
  assertEqual(typeof version, "number");
});

it("carries a version and every required operation, as functions", async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);

  assertEqual(probed.version, CAROM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }
});

it("takes the game off the wall clock, and runs whole frames on demand", async () => {
  // The harness has already called `setAutoStep(false)`. So a match is opened and
  // served, and then real time is simply allowed to pass: a build still running
  // itself off the wall clock moves the ball and its own clock while this waits,
  // and one that really disconnected does not move at all.
  await startPlaying(h, "solo");
  const frozen = await h.snapshot();
  await new Promise((resolve) => setTimeout(resolve, FROZEN_MS));
  const still = await h.snapshot();

  assertEqual(still.simTime, frozen.simTime);
  assertEqual(ball0(still).x, ball0(frozen).x);
  assertEqual(ball0(still).y, ball0(frozen).y);

  // And an advance runs real frames: the game's own clock moves by exactly the
  // time asked for, and the simulation moves with it.
  await h.advance(120); // one second at the suite's 120 Hz
  const driven = await h.snapshot();

  assertCloseTo(driven.simTime - frozen.simTime, 1, 6);
  assertGreaterThan(
    Math.hypot(
      ball0(driven).x - ball0(frozen).x,
      ball0(driven).y - ball0(frozen).y,
    ),
    1,
  );
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await startPlaying(h, "versus");
  await h.advance(36); // 0.3 s of real flight, so the reads are of live play
  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so the two can be held against each other.
  await captureStill(h, "state");

  const snapshot = await h.snapshot();

  assertEqual(typeof snapshot.version, "number");
  assertContains(
    ["title", "howto", "countdown", "playing", "paused", "matchover"],
    snapshot.screen,
  );
  assertContains(["solo", "versus"], snapshot.mode);
  assertEqual(typeof snapshot.score.p1, "number");
  assertEqual(typeof snapshot.score.p2, "number");
  assertHasProperty(snapshot, "winner");
  assertEqual(typeof snapshot.muted, "boolean");

  for (const side of ["left", "right"] as const) {
    assertEqual(typeof snapshot.paddles[side].cy, "number");
    assertEqual(typeof snapshot.paddles[side].vy, "number");
  }

  for (const field of ["x", "y", "vx", "vy", "speed", "spin"] as const) {
    assertEqual(typeof ball0(snapshot)[field], "number");
  }
  assertEqual(typeof ball0(snapshot).held, "boolean");
  assertEqual(typeof snapshot.simTime, "number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held and it is moving at the speed its serve gave it.
  assertEqual(snapshot.screen, "playing");
  assertEqual(ball0(snapshot).held, false);
  assertGreaterThan(ball0(snapshot).speed, 0);
  assertCloseTo(
    ball0(snapshot).speed,
    Math.hypot(ball0(snapshot).vx, ball0(snapshot).vy),
    6,
  );
  assertGreaterThan(snapshot.simTime, 0);
});

it("poses the game through the state the build declared", async () => {
  // A match opens on the pre-serve countdown, with the ball held at the centre.
  // The hold itself is read through `held` rather than off a timer field: the
  // state object is the build's own and is reachable only through the snapshot
  // here, and `held` is documented as true for exactly as long as the pre-serve
  // countdown is running (specs/instrumentation.md).
  await h.debug.startMatch("versus");
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  // And the hold really is a countdown rather than a latch: it runs out within
  // the specified time, and the game serves itself out of it.
  const served = await h.until((s) => s.screen === "playing", {
    maxFrames: Math.ceil(HOLD_TIME * 120) + 12,
    poll: 1,
  });
  assertEqual(served.hit, true);
  assertEqual(ball0(served.snapshot).held, false);

  // A posed paddle stays where it was put, and a posed velocity persists across
  // frames rather than being a one-frame nudge.
  await h.debug.setPaddle("left", { cy: 200, vy: 0 });
  await h.debug.setPaddle("right", { cy: 500, vy: 0 });
  await h.advance(24);
  const posed = await h.snapshot();
  assertCloseTo(posed.paddles.left.cy, 200, 3);
  assertCloseTo(posed.paddles.right.cy, 500, 3);

  // A posed score is the score.
  await h.debug.setScore(3, 4);
  await h.advance(1);
  assertDeepEqual((await h.snapshot()).score, { p1: 3, p2: 4 });

  // And a reset returns the whole of it to the title.
  await h.debug.reset();
  await h.advance(1);
  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertCloseTo(title.paddles.left.cy, FIELD_CY, 3);
  assertCloseTo(title.paddles.right.cy, FIELD_CY, 3);
});
