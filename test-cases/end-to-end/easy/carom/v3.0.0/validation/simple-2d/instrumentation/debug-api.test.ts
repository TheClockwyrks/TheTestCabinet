// Carom — instrumentation/debug-api: the build returned its debug and automation
// surface beside its state, and that surface is whole and really backed by the
// state the build declared.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S.
//
// The first is the surface itself. specs/instrumentation.md specifies every
// operation, and the build implements them and returns the finished surface
// from `initialize`, beside the state, as `[state, debug]`. The runtime holds
// the second element and returns it from `engine.debug`, and nothing else can
// reach a check: a build that returned no surface leaves `engine.debug` with
// nothing to hand over. That is what the first check below establishes, reading
// the surface off the runtime the harness constructed, and the second holds it
// to the version and the operation list the specification fixes.
//
// The second half is the state behind it. An operation that exists but reads a
// field the build hollowed out, or poses one the game ignores, is a surface that
// is present and useless, and that is what a snapshot read off a real, driven
// match catches.
//
// EVERY OPERATION IS ATOMIC, AND THAT IS WHAT THE LAST CHECK READS. Each one sets
// one field or one fixed pair, places or removes one entity, or reads the state,
// and `reset` is the sole exception (specs/instrumentation.md). So the sweep below
// poses one thing at a time and reads it straight back off the snapshot — which
// is the specification's own promise, that "every field an operation of this
// surface sets appears here, so every operation is verified by setting a value
// and reading it back". Two of those readings are about what an operation does
// NOT touch: `setScreen` opens a match without taking a paddle from anyone, and
// `setPaddleDriven` takes the side it names and leaves the other side under the
// player.
//
// The clock, the keyboard, and the overlay are the engine's under this engine,
// so the surface carries no operation for any of them (specs/instrumentation.md),
// and demanding one here would fail a perfectly conformant build. What it does
// carry is the list in `surface.ts`: the reads, and the control operations that
// pose a scenario in the game's own world.
//
// This is the one check in the suite whose subject is the whole state, so it is
// also the one that does not empty the field: what it reads back from `reset` is
// the title-screen world specs/state.md fixes, both obstacles and the ball
// included, and it empties and repopulates the field only to read `clearWorld`,
// `spawnObstacle` and `spawnBall` back.
//
// Every other automated item drives this surface to pose its own scenario, so a
// missing surface or a state the build reshaped also shows up as those items
// failing to run. This one names the fault plainly.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertLessThan,
  assertLessThanOrEqual,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  allBalls,
  ball0,
  ballsAreIndexed,
  captureStill,
  createHarness,
  drivePaddleAt,
  holdTimer0,
  openCountdown,
  seconds,
  spawnBall,
  startPlaying,
  type Harness,
} from "../harness";
import { CAROM_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

/** The velocity the driven paddle is posed at, and how long it holds it. */
const DRIVEN_CY = 200;
const DRIVEN_VY = -60;
const DRIVEN_TICKS = 24; // 0.2 s

/** The draw posed on the ball: a serve sign under `base` and `gyre`, a launch angle under `multi`. */
const POSED_SIGN = -1;
const POSED_ANGLE = 2.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface beside its state from initialize", () => {
  // `engine.debug` is whatever the build's `initialize` returned as the second
  // element of `[state, debug]`, so reading it is the check: there is no page
  // property to look for and nothing the harness could have supplied in the
  // build's place. A build that returned `null` there has no surface.
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug);

  // The runtime returns the value the game handed over, unchanged and unwrapped,
  // so every read is the same object. It is the one the rest of this suite —
  // and every other check in this directory — poses the game through: `h.debug`
  // drives this object over the runtime, running each pose through
  // `engine.apply` and handing `engine.state` to each reading.
  assertEqual(h.engine.debug, h.engine.debug);
  assertEqual(typeof h.engine.debug, "object");
});

it("carries a version and every required operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number");
  assertEqual(api.version, CAROM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof api[op], "function");
  }
  // The draw operations differ by variant: the serve sign under `base` and
  // `gyre`, the launch angle under `multi` (specs/instrumentation.md).
  const drawOps = ballsAreIndexed(h)
    ? ["setBallLaunchAngle", "drawBallLaunchAngle"]
    : ["setBallServeSign", "drawBallServeSign"];
  for (const op of drawOps) {
    assertEqual(typeof api[op], "function");
  }
});

it("writes its operations in the shape of update: state in, state out", () => {
  // The runtime hands the state out read-only and holds it by value, so an
  // operation that mutated what it was given would change nothing the next
  // frame sees. A pose returns the next state; a reading returns what it read;
  // and neither writes to the state it was handed. The snapshot is read off
  // the runtime's current value, and a pose is run through `engine.apply`.
  const api = h.engine.debug;
  const before = h.engine.state;

  const snapshot = api.snapshot(before);
  assertEqual(typeof snapshot, "object");
  assertEqual(snapshot.screen, "title");

  const posed = api.setScreen(before, "countdown");
  assertNotEqual(posed, undefined, "setScreen must return the next state");
  assertNotEqual(posed, before);
  // The runtime's state is untouched until a transition is applied…
  assertEqual(api.snapshot(h.engine.state).screen, "title");
  // …and the posed value is what it holds once one is.
  h.engine.apply(() => posed);
  assertEqual(h.snapshot().screen, "countdown");
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await startPlaying(h, "versus");
  await h.advance(36); // 0.3 s of real flight, so the reads are of live play
  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so the two can be held against each other.
  captureStill(h, "state");

  const snapshot = h.snapshot();

  assertEqual(typeof snapshot.version, "number");
  assertContains(
    ["title", "howto", "countdown", "playing", "paused", "matchover"],
    snapshot.screen,
  );
  assertContains(["solo", "versus"], snapshot.mode);
  assertEqual(typeof snapshot.menuIndex, "number");
  assertEqual(typeof snapshot.titleIndex, "number");
  assertContains(["countdown", "playing"], snapshot.resumeScreen);
  assertEqual(typeof snapshot.score.p1, "number");
  assertEqual(typeof snapshot.score.p2, "number");
  assertHasProperty(snapshot, "winner");
  assertEqual(typeof snapshot.muted, "boolean");

  // A paddle carries its integrated `vy` and the `drivenVy` a pose last set for
  // that side as two separate fields, beside whether the surface is moving it.
  for (const side of ["left", "right"] as const) {
    assertEqual(typeof snapshot.paddles[side].cy, "number");
    assertEqual(typeof snapshot.paddles[side].vy, "number");
    assertEqual(typeof snapshot.paddles[side].drivenVy, "number");
    assertEqual(typeof snapshot.paddles[side].driven, "boolean");
  }

  // The AI's two faculties are reported separately, because they are gated
  // separately (specs/instrumentation.md).
  assertEqual(typeof snapshot.ai.tracking, "boolean");
  assertEqual(typeof snapshot.ai.movement, "boolean");

  for (const field of ["x", "y", "vx", "vy", "speed", "spin"] as const) {
    assertEqual(typeof ball0(snapshot)[field], "number");
  }
  assertEqual(typeof ball0(snapshot).held, "boolean");
  assertEqual(typeof ball0(snapshot).holdTimer, "number");
  // The draw a serve or a launch rests on is the ball's own field: the sign a
  // serve takes under `base` and `gyre`, the angle a launch leaves along under
  // `multi` (specs/state.md).
  if (ballsAreIndexed(h)) {
    assertEqual(typeof ball0(snapshot).launchAngle, "number");
  } else {
    assertContains([1, -1], ball0(snapshot).serveSign);
  }
  assertEqual(Array.isArray(ball0(snapshot).trail), true);
  for (const sample of ball0(snapshot).trail) {
    assertEqual(typeof sample.x, "number");
    assertEqual(typeof sample.y, "number");
    assertEqual(typeof sample.t, "number");
  }

  // The world's contents are reported too: every obstacle present, each under its
  // own index and at its live center.
  assertEqual(Array.isArray(snapshot.obstacles), true);
  for (const obstacle of snapshot.obstacles) {
    assertEqual(typeof obstacle.index, "number");
    assertEqual(typeof obstacle.cx, "number");
    assertEqual(typeof obstacle.cy, "number");
  }
  assertEqual(typeof snapshot.simTime, "number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held and it is moving at the speed its serve gave it, and the trail
  // it has been laying down behind it is not empty.
  assertEqual(snapshot.screen, "playing");
  assertEqual(ball0(snapshot).held, false);
  assertGreaterThan(ball0(snapshot).speed, 0);
  assertCloseTo(
    ball0(snapshot).speed,
    Math.hypot(ball0(snapshot).vx, ball0(snapshot).vy),
    6,
  );
  assertGreaterThan(ball0(snapshot).trail.length, 0);
  assertGreaterThan(snapshot.simTime, 0);
});

it("poses the game through the state the build declared", async () => {
  // A match opens on the pre-serve countdown, with the ball held at its home. The
  // three poses that get there — `reset`, `setMode`, `setScreen` — are all that
  // runs, and `setScreen` puts the game on a screen and touches nothing else, so
  // BOTH paddles are still the player's. That is the whole point of a surface
  // that takes one side at a time, and a match opened this way is one a check
  // about the real controls can play.
  openCountdown(h, "versus");
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "versus");
  assertEqual(ball0(opened).held, true);
  assertGreaterThan(holdTimer0(h), 0);
  assertLessThanOrEqual(holdTimer0(h), HOLD_TIME);
  assertEqual(opened.paddles.left.driven, false);
  assertEqual(opened.paddles.right.driven, false);

  // ONE paddle, taken on its own side. The left is posed at `DRIVEN_CY` and
  // driven at `DRIVEN_VY`, and a posed `drivenVy` persists across frames rather
  // than being a one-frame nudge, so the left really travels for the whole hold.
  // The right is left exactly as it was — still the player's, still centred,
  // because nothing pressed a key.
  drivePaddleAt(h, "left", DRIVEN_CY, DRIVEN_VY);
  await h.advance(DRIVEN_TICKS);
  const driven = h.snapshot();
  assertEqual(driven.paddles.left.driven, true);
  assertEqual(driven.paddles.left.drivenVy, DRIVEN_VY);
  assertCloseTo(
    driven.paddles.left.cy,
    DRIVEN_CY + DRIVEN_VY * seconds(DRIVEN_TICKS),
    1,
  );
  assertEqual(driven.paddles.right.driven, false);
  assertEqual(driven.paddles.right.drivenVy, 0);
  assertCloseTo(driven.paddles.right.cy, FIELD_CY, 1);

  // A posed score is the score, and it survives the frames that follow.
  h.debug.setScore(3, 4);
  await h.advance(1);
  assertDeepEqual(h.snapshot().score, { p1: 3, p2: 4 });

  // A posed winner reads back, and `null` clears it. Read without advancing:
  // reaching the match-over screen is the win rule's own doing on a scored
  // point, and this is a field being set, not a match being ended.
  h.debug.setWinner("right");
  assertEqual(h.snapshot().winner, "right");
  h.debug.setWinner(null);
  assertNull(h.snapshot().winner);

  // The AI's two faculties are gated one at a time, and each reads back on its
  // own: tracking off with movement still on is a state the surface can express.
  h.debug.setAiTracking(false);
  await h.advance(1);
  assertDeepEqual(h.snapshot().ai, { tracking: false, movement: true });
  h.debug.setAiMovement(false);
  await h.advance(1);
  assertDeepEqual(h.snapshot().ai, { tracking: false, movement: false });

  // The draw a serve or a launch rests on is posed as the ball's own field and
  // drawn afresh on its own: the posed value reads back, and a fresh draw lands
  // inside the range specs/balls.md fixes.
  if (ballsAreIndexed(h)) {
    h.multi.setBallLaunchAngle(0, POSED_ANGLE);
    assertEqual(ball0(h.snapshot()).launchAngle, POSED_ANGLE);
    h.multi.drawBallLaunchAngle(0);
    const drawn = ball0(h.snapshot()).launchAngle as number;
    assertGreaterThanOrEqual(drawn, 0);
    assertLessThan(drawn, 2 * Math.PI);
  } else {
    h.debug.setBallServeSign(POSED_SIGN);
    assertEqual(ball0(h.snapshot()).serveSign, POSED_SIGN);
    h.debug.drawBallServeSign();
    assertContains([1, -1], ball0(h.snapshot()).serveSign);
  }

  // The menu fields are posed on a screen that shows a menu, so the index posed
  // names a real item: the last entry of `PAUSE_ITEMS`, and the last of
  // `TITLE_ITEMS`.
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(PAUSE_ITEMS.length - 1);
  h.debug.setTitleIndex(TITLE_ITEMS.length - 1);
  h.debug.setResumeScreen("countdown");
  await h.advance(1);
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, PAUSE_ITEMS.length - 1);
  assertEqual(paused.titleIndex, TITLE_ITEMS.length - 1);
  assertEqual(paused.resumeScreen, "countdown");

  // The world is emptied and repopulated one entity at a time. A cleared field
  // reports no ball and no obstacle; the paddles stay, because a paddle is
  // furniture the game always has.
  h.debug.clearWorld();
  const cleared = h.snapshot();
  assertLength(allBalls(cleared), 0);
  assertLength(cleared.obstacles, 0);

  h.debug.spawnObstacle(1);
  const oneObstacle = h.snapshot();
  assertLength(oneObstacle.obstacles, 1);
  assertEqual(oneObstacle.obstacles[0].index, 1);
  // Its center x is fixed in every variant: gyre sways an obstacle vertically
  // about this point and rotates it about its own center, and neither moves x.
  assertCloseTo(oneObstacle.obstacles[0].cx, OBSTACLE_CENTERS[1].x, 1);

  spawnBall(h);
  const respawned = h.snapshot();
  assertLength(allBalls(respawned), 1);
  assertEqual(ball0(respawned).held, true);
  assertCloseTo(ball0(respawned).holdTimer, HOLD_TIME, 6);
  assertCloseTo(ball0(respawned).vx, 0, 6);
  assertCloseTo(ball0(respawned).vy, 0, 6);
  assertCloseTo(ball0(respawned).spin, 0, 6);
  assertLength(ball0(respawned).trail, 0);

  // And a reset returns the whole of it to the title screen specs/state.md
  // fixes — every field at once, which is the one operation that is not atomic.
  // Read before a frame runs, because `simTime` is `0` there and the very next
  // update adds its own delta to it.
  h.debug.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.mode, "solo");
  assertEqual(title.menuIndex, 0);
  assertEqual(title.titleIndex, 0);
  assertEqual(title.resumeScreen, "playing");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertEqual(title.simTime, 0);
  assertDeepEqual(title.ai, { tracking: true, movement: true });
  for (const side of ["left", "right"] as const) {
    assertCloseTo(title.paddles[side].cy, FIELD_CY, 1);
    assertEqual(title.paddles[side].vy, 0);
    assertEqual(title.paddles[side].drivenVy, 0);
    assertEqual(title.paddles[side].driven, false);
  }
  assertEqual(ball0(title).held, true);
  assertCloseTo(ball0(title).holdTimer, HOLD_TIME, 6);
  assertLength(ball0(title).trail, 0);
  assertLength(title.obstacles, OBSTACLE_CENTERS.length);
});
