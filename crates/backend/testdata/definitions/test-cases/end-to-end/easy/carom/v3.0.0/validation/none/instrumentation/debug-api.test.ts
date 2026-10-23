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
// snapshot read off a real, driven match catches. The surface is ATOMIC — every
// operation sets one field, places or removes one entity, reads the state, or
// moves the clock — and the specification's own summary of that is "every field
// an operation of this surface sets appears here, so every operation is verified
// by setting a value and reading it back". So the pose half below writes a value
// through one operation and reads that same field back off the snapshot, and it
// does that for the world, the paddles' two separate faculties, the score, the
// draw a serve or a launch rests on, and the whole of what `reset` restores.
//
// The third is the CLOCK, which exists only under this engine. Nothing outside an
// engineless build owns its loop, so `setAutoStep` and `advance` are on the
// surface and everything else in this suite rests on them: a build whose
// `advance` does not really run whole frames of the length asked for gives every
// other check a scenario that drifts under it. So this point drives `advance`
// directly and reads the game's own clock and a ball in flight back off it. What
// `setAutoStep(false)` disconnects is real time, and real time is the one thing
// no check here waits on, so the clock is read only through the frames this
// point asks for.
//
// THIS POINT IS THE ONE THAT DOES NOT ISOLATE ITS WORLD, and that is the
// requirement rather than an exception to it. What it decides is that the surface
// poses and reports the state the build declared, and `clearWorld`, `spawnBall`
// and `spawnObstacle` are three of the operations it decides — so the field is
// emptied and filled here as the subject of the check, and the driven-clock
// reading wants the whole standard world in play rather than one body.
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
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertLessThan,
  assertNear,
  assertNull,
} from "../assert";
import { FIELD_CY, HOLD_TIME, OBSTACLE_CENTERS } from "../constants";
import {
  allBalls,
  ball0,
  captureStill,
  CAROM_DEBUG_VERSION,
  clearField,
  createHarness,
  failSurface,
  HANDLE,
  openCountdown,
  REQUIRED_OPS,
  seconds,
  startPlaying,
  takePaddle,
  TICK_HZ,
  type Harness,
  type MultiBallOps,
} from "../harness";

/** The frames of live flight the snapshot below is read off. */
const FLIGHT_TICKS = 36; // 0.3 s

/** Where the pose half stands the two paddles, in logical px. */
const POSED_LEFT_CY = 200;
const POSED_RIGHT_CY = 500;

/**
 * The velocity the driven paddle is given, and how long it holds it.
 *
 * Upward and modest: over `DRIVE_TICKS` the left paddle travels 120 px from
 * `POSED_LEFT_CY` to 80, which is clear of `PADDLE_MIN_CY` (`55`), so what is
 * read is the drive rather than the clamp `specs/playfield.md` puts under it.
 */
const DRIVE_VY = -240;
const DRIVE_TICKS = 60; // 0.5 s

/** Where that drive lands the paddle, by the integration the specification fixes. */
const DRIVEN_CY = POSED_LEFT_CY + DRIVE_VY * seconds(DRIVE_TICKS);

/**
 * How far the driven paddle may sit from that, in logical px: one frame of its
 * own travel.
 *
 * The distance is fixed arithmetic rather than a measurement, so the only slop
 * worth allowing is which frame the build first integrates a `drivenVy` set
 * while the paddle stood still on — and `specs/instrumentation.md` fixes even
 * that. One frame is therefore already generous, and it is far under the 120 px
 * the drive covers.
 */
const DRIVE_TOL = Math.abs(DRIVE_VY) * seconds(1);

/**
 * How far a figure read straight back may sit from the one that was posed, in
 * that figure's own units.
 *
 * A pose is an assignment rather than a measurement, and a paddle nobody is
 * moving does not drift at all, so this is room for float noise and nothing
 * else.
 */
const POSE_TOL = 0.5;

/** The draw posed on the ball: a serve sign under `base` and `gyre`, a launch angle under `multi`. */
const POSED_SIGN = -1;
const POSED_ANGLE = 2.5;

/** The scores posed through `setScore`, which is a fixed pair rather than a patch. */
const POSED_SCORE = { p1: 3, p2: 4 } as const;

/** The six screen names `specs/ui.md` fixes. */
const SCREENS = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "matchover",
] as const;

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
  // The draw operations differ by variant: the serve sign under `base` and
  // `gyre`, the launch angle under `multi` (specs/instrumentation.md).
  const drawOps =
    (await h.snapshot()).balls !== undefined
      ? ["setBallLaunchAngle", "drawBallLaunchAngle"]
      : ["setBallServeSign", "drawBallServeSign"];
  const drawProbe = await h.probe(drawOps);
  for (const op of drawOps) {
    assertEqual(drawProbe.ops[op], "function", `window.${HANDLE}.${op}`);
  }
});

it("runs whole frames on demand", async () => {
  // The harness has already called `setAutoStep(false)`, so a match is opened and
  // served and the only frames the game runs from here are the ones asked for.
  // An advance runs real frames: the game's own clock moves by exactly the time
  // asked for, and the simulation moves with it. The match is a Versus one, so
  // the only thing with any reason to move across those frames is the ball's own
  // flight.
  await startPlaying(h, "versus");
  const served = await h.snapshot();
  await h.advance(TICK_HZ); // one second at the suite's clock
  const driven = await h.snapshot();

  assertCloseTo(driven.simTime - served.simTime, 1, 6);
  assertGreaterThan(
    Math.hypot(
      ball0(driven).x - ball0(served).x,
      ball0(driven).y - ball0(served).y,
    ),
    1,
  );
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await startPlaying(h, "versus");
  await h.advance(FLIGHT_TICKS); // real flight, so the reads are of live play
  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so the two can be held against each other.
  await captureStill(h, "state");

  const snapshot = await h.snapshot();

  assertEqual(typeof snapshot.version, "number");
  assertContains(SCREENS, snapshot.screen);
  assertContains(["solo", "versus"], snapshot.mode);
  assertEqual(typeof snapshot.menuIndex, "number");
  assertEqual(typeof snapshot.titleIndex, "number");
  assertContains(["countdown", "playing"], snapshot.resumeScreen);
  assertEqual(typeof snapshot.score.p1, "number");
  assertEqual(typeof snapshot.score.p2, "number");
  assertHasProperty(snapshot, "winner");
  assertEqual(typeof snapshot.muted, "boolean");

  // The AI's two faculties are reported separately, because they are gated
  // separately (specs/instrumentation.md).
  assertEqual(typeof snapshot.ai.tracking, "boolean");
  assertEqual(typeof snapshot.ai.movement, "boolean");

  // A paddle carries its integrated `vy`, the `drivenVy` the surface last wrote,
  // and who is moving it — three fields rather than one.
  for (const side of ["left", "right"] as const) {
    assertEqual(typeof snapshot.paddles[side].cy, "number");
    assertEqual(typeof snapshot.paddles[side].vy, "number");
    assertEqual(typeof snapshot.paddles[side].drivenVy, "number");
    assertEqual(typeof snapshot.paddles[side].driven, "boolean");
  }

  const ball = ball0(snapshot);
  for (const field of [
    "x",
    "y",
    "vx",
    "vy",
    "speed",
    "spin",
    "holdTimer",
  ] as const) {
    assertEqual(typeof ball[field], "number");
  }
  assertEqual(typeof ball.held, "boolean");

  // Every obstacle the field holds, each under its own index and its live center.
  assertLength(snapshot.obstacles, OBSTACLE_CENTERS.length);
  for (const [index, obstacle] of snapshot.obstacles.entries()) {
    assertEqual(obstacle.index, index);
    assertEqual(typeof obstacle.cx, "number");
    assertEqual(typeof obstacle.cy, "number");
  }

  assertEqual(typeof snapshot.autoStep, "boolean");
  assertEqual(typeof snapshot.simTime, "number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held and it is moving at the speed its serve gave it.
  assertEqual(snapshot.screen, "playing");
  assertEqual(ball.held, false);
  assertGreaterThan(ball.speed, 0);
  assertCloseTo(ball.speed, Math.hypot(ball.vx, ball.vy), 6);
  assertGreaterThan(snapshot.simTime, 0);

  // And the trail is the game's own writing rather than a field the surface
  // fills: a sample is appended on every countdown or playing frame after the
  // ball is advanced (specs/state.md), so a third of a second of flight has left
  // samples in it.
  assertGreaterThan(ball.trail.length, 0);
  for (const sample of ball.trail) {
    assertEqual(typeof sample.x, "number");
    assertEqual(typeof sample.y, "number");
    assertEqual(typeof sample.t, "number");
  }
});

it("poses the game through the state the build declared", async () => {
  // A match opens on the pre-serve countdown through the atomic poses alone — a
  // reset, the mode, then the screen — with the world placed exactly as
  // `spawnBall` and `spawnObstacle` place it: the ball at its home point, held,
  // with a full hold timer.
  await openCountdown(h, "versus");
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "versus");
  assertEqual(ball0(opened).held, true);

  // And the hold really is a countdown rather than a latch: it runs out within
  // the specified time, and the game serves itself out of it through its own
  // rule, on a frame this check only advanced.
  const served = await h.until((s) => s.screen === "playing", {
    maxFrames: Math.ceil(HOLD_TIME * TICK_HZ) + 12,
    poll: 1,
  });
  assertEqual(served.hit, true);
  assertEqual(ball0(served.snapshot).held, false);

  // The draw a serve or a launch rests on is posed as the ball's own field and
  // drawn afresh on its own: the posed value reads back, and a fresh draw lands
  // inside the range specs/balls.md fixes.
  if ((await h.snapshot()).balls !== undefined) {
    const multi = h.debug as unknown as MultiBallOps;
    await multi.setBallLaunchAngle(0, POSED_ANGLE);
    assertEqual(ball0(await h.snapshot()).launchAngle, POSED_ANGLE);
    await multi.drawBallLaunchAngle(0);
    const drawn = ball0(await h.snapshot()).launchAngle as number;
    assertGreaterThanOrEqual(drawn, 0);
    assertLessThan(drawn, 2 * Math.PI);
  } else {
    await h.debug.setBallServeSign(POSED_SIGN);
    assertEqual(ball0(await h.snapshot()).serveSign, POSED_SIGN);
    await h.debug.drawBallServeSign();
    assertContains([1, -1], ball0(await h.snapshot()).serveSign);
  }

  // The world operations really empty the field and put bodies back on it, which
  // is what every posed scenario in this project stands on: a cleared field
  // reports no ball and no obstacle, and a spawn returns exactly the entity it
  // names, under its own index.
  await clearField(h);
  await h.advance(1);
  const cleared = await h.snapshot();
  assertLength(allBalls(cleared), 0);
  assertLength(cleared.obstacles, 0);

  await h.debug.spawnObstacle(0);
  await h.advance(1);
  const spawned = (await h.snapshot()).obstacles;
  assertLength(spawned, 1);
  assertEqual(spawned[0].index, 0);

  // The field is left with no ball on it for the poses below, so nothing can
  // score, collide or serve while a posed field is being read back.

  // A posed paddle stays where it was put: `setPaddleCy` sets that side's center
  // and nothing else, and a paddle nobody has taken is moved by nobody in a
  // Versus match with no key held.
  await h.debug.setPaddleCy("left", POSED_LEFT_CY);
  await h.debug.setPaddleCy("right", POSED_RIGHT_CY);
  await h.advance(24);
  const posed = await h.snapshot();
  assertNear(posed.paddles.left.cy, POSED_LEFT_CY, POSE_TOL);
  assertNear(posed.paddles.right.cy, POSED_RIGHT_CY, POSE_TOL);
  assertEqual(posed.paddles.left.driven, false);
  assertEqual(posed.paddles.right.driven, false);

  // Driving a paddle is two operations on one side: `setPaddleVy` writes that
  // side's `drivenVy` and `setPaddleDriven` decides who moves it. Both are read
  // straight back off the snapshot, and taking one side leaves the other as it
  // was — which is the whole point of the flag being per side.
  await takePaddle(h, "left", DRIVE_VY);
  const taken = await h.snapshot();
  assertEqual(taken.paddles.left.driven, true);
  assertNear(taken.paddles.left.drivenVy, DRIVE_VY, POSE_TOL);
  assertEqual(taken.paddles.right.driven, false);

  // And a driven paddle really travels at that velocity, held across frames
  // rather than spent as a one-frame nudge.
  await h.advance(DRIVE_TICKS);
  const drivenPaddles = (await h.snapshot()).paddles;
  assertNear(drivenPaddles.left.cy, DRIVEN_CY, DRIVE_TOL);
  assertNear(drivenPaddles.right.cy, POSED_RIGHT_CY, POSE_TOL);

  // A posed score is the score: both sides at once, as a fixed pair.
  await h.debug.setScore(POSED_SCORE.p1, POSED_SCORE.p2);
  await h.advance(1);
  assertDeepEqual((await h.snapshot()).score, POSED_SCORE);

  // And a reset returns the whole of it to the title state `specs/state.md`
  // fixes, in one operation: the title screen in Solo, no score, no winner, both
  // menus at their first item, both paddles centered with nothing driving them,
  // the AI holding both faculties, the world placed as the two spawns place it,
  // and the clock's accumulator at zero. Read
  // without advancing a frame, because `simTime` is one of the figures restored
  // and the next frame would add its own delta time to it.
  await h.debug.reset();
  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.mode, "solo");
  assertEqual(title.menuIndex, 0);
  assertEqual(title.titleIndex, 0);
  assertEqual(title.resumeScreen, "playing");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertNear(title.paddles.left.cy, FIELD_CY, POSE_TOL);
  assertNear(title.paddles.right.cy, FIELD_CY, POSE_TOL);
  assertEqual(title.paddles.left.driven, false);
  assertEqual(title.paddles.right.driven, false);
  assertNear(title.paddles.left.drivenVy, 0, POSE_TOL);
  assertNear(title.paddles.right.drivenVy, 0, POSE_TOL);
  assertDeepEqual(title.ai, { tracking: true, movement: true });
  assertLength(title.obstacles, OBSTACLE_CENTERS.length);
  assertEqual(ball0(title).held, true);
  assertEqual(title.simTime, 0);
});
