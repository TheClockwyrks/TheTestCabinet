// Carom — instrumentation/debug-api: the build returned its debug and automation
// surface from initialize, and that surface is whole and really backed by the
// running game.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S.
//
// The first is the surface itself. specs/instrumentation.md specifies every
// operation, and the build implements them and returns the finished surface
// from its instance's `initialize`. The engine holds that value and hands it
// back from `engine.debug`, and nothing else can reach a check: a build that
// returned no surface leaves `engine.debug` with nothing to hand over. That is
// what the first check below establishes, reading the surface off the engine
// the harness constructed, and the second holds it to the version and the
// operation list the specification fixes.
//
// The second half is the game behind it. An operation that exists but arranges
// nothing the frames that follow honor, or reads a value the game does not
// hold, is a surface that is present and useless, and that is what a snapshot
// read off a real, driven match catches.
//
// EVERY OPERATION IS ATOMIC, so a scenario here is a SEQUENCE of them. There is
// no operation that opens a match, seizes a paddle or serves a ball: a screen is
// set by `setScreen`, a paddle is put by `setPaddleCy` and taken by
// `setPaddleDriven`, and a serve is a hold running out. That is the shape the
// last two checks drive, one atomic pose at a time, reading each one back off
// the snapshot — which is what specs/instrumentation.md means by "every
// operation is verified by setting a value and reading it back".
//
// THE WORLD THIS ONE POSES IS THE STANDARD ONE, and that is the isolation the
// requirement asks for rather than an exception to it. What this point is about
// is the WHOLE declared shape, `obstacles` and the ball included, so a field
// cleared of them would remove the very readings being checked. Nothing is
// contained here either: no drive crosses the field, so there is nothing on it a
// bystander could interfere with.
//
// The clock, the keyboard, and the overlay are the engine's under this engine,
// so the surface carries no operation for any of them (specs/instrumentation.md),
// and demanding one here would fail a perfectly conformant build. What it does
// carry is the list in `surface.ts`: the two readings, and the poses that each
// set one field, place or remove one entity, or — `reset` alone — restore the
// whole of it, acting on the game's own running world.
//
// Every other automated item drives this surface to pose its own scenario, so a
// missing surface or an operation that does not act also shows up as those
// items failing to run. This one names the fault plainly.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, HOLD_TIME, OBSTACLE_CENTERS } from "../constants";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertLength,
  assertLessThanOrEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  TICK_HZ,
  ball0,
  ballOps,
  captureStill,
  createHarness,
  openPlaying,
  type Harness,
} from "../harness";
import { CAROM_DEBUG_VERSION, DEFAULT_SEED, REQUIRED_OPS } from "../surface";

/** Where the two paddles are put, to be read back off the snapshot. */
const LEFT_CY = 200;
const RIGHT_CY = 500;

/** A seed that is not the title screen's, so reseeding is visible. */
const PROBE_SEED = 20260903;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface from initialize", () => {
  // `engine.debug` is whatever the build's instance returned from `initialize`,
  // so reading it is the check: there is no page property to look for and
  // nothing the harness could have supplied in the build's place. A build whose
  // `initialize` returned nothing never gets this far, because the engine
  // rejects `initialize` itself.
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug);

  // The engine hands back the value the instance returned, unchanged and
  // unwrapped, so every read is the same object. It is the one the rest of this
  // suite — and every other check in this directory — poses the game through:
  // `h.debug` is this object, driven directly, each operation acting on the
  // live world at the moment of the call.
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
});

it("writes its operations as methods that act on the running game", async () => {
  // A reading returns plain data off the world at the instant of the call and
  // changes nothing: two reads with no frame between them report the same
  // thing.
  const api = h.debug;
  const first = api.snapshot();
  assertEqual(typeof first, "object");
  assertEqual(first.screen, "title");
  assertDeepEqual(api.snapshot(), first);

  // A pose returns nothing and acts on the live game. `setScreen` is the one
  // whose effect the spec allows to land at the call or as late as the end of
  // the next advanced frame (specs/instrumentation.md), so it is read the way
  // every scenario reads such a pose — after an advanced frame.
  api.setScreen("countdown");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "countdown");

  // Every other pose sets its own field alone and is readable at once, with no
  // frame in between: the surface acts on the live world at the moment of the
  // call.
  api.setScore(3, 4);
  assertDeepEqual(api.snapshot().score, { p1: 3, p2: 4 });
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await openPlaying(h, "versus");
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
  assertEqual(typeof snapshot.seed, "number");
  assertEqual(typeof snapshot.rngState, "number");

  for (const side of ["left", "right"] as const) {
    assertEqual(typeof snapshot.paddles[side].cy, "number");
    assertEqual(typeof snapshot.paddles[side].vy, "number");
    assertEqual(typeof snapshot.paddles[side].drivenVy, "number");
    assertEqual(typeof snapshot.paddles[side].driven, "boolean");
  }

  assertEqual(typeof snapshot.ai.tracking, "boolean");
  assertEqual(typeof snapshot.ai.movement, "boolean");

  const ball = ball0(snapshot);
  for (const field of ["x", "y", "vx", "vy", "speed", "spin"] as const) {
    assertEqual(typeof ball[field], "number");
  }
  assertEqual(typeof ball.held, "boolean");
  assertEqual(typeof ball.holdTimer, "number");

  // The obstacles the title screen placed are still on the field, each reported
  // under its own index at a live centre. Their `theta` is gyre's alone, so
  // nothing is read here beyond the shape every variant carries.
  assertLength(snapshot.obstacles, OBSTACLE_CENTERS.length);
  for (const obstacle of snapshot.obstacles) {
    assertEqual(typeof obstacle.index, "number");
    assertEqual(typeof obstacle.cx, "number");
    assertEqual(typeof obstacle.cy, "number");
  }
  assertEqual(typeof snapshot.simTime, "number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held, its hold has run out, and it is moving at the speed its
  // serve gave it.
  assertEqual(snapshot.screen, "playing");
  assertEqual(ball.held, false);
  assertEqual(ball.holdTimer, 0);
  assertGreaterThan(ball.speed, 0);
  assertCloseTo(ball.speed, Math.hypot(ball.vx, ball.vy), 6);
  assertGreaterThan(snapshot.simTime, 0);

  // The trail is written by the game rather than posed (specs/state.md), so a
  // ball that has been flying for longer than TRAIL_TIME has samples in it, and
  // each one carries the position and the moment the state declares.
  assertGreaterThan(ball.trail.length, 0);
  for (const sample of ball.trail) {
    assertEqual(typeof sample.x, "number");
    assertEqual(typeof sample.y, "number");
    assertEqual(typeof sample.t, "number");
  }
});

it("poses the running game through the same systems play uses", async () => {
  // A countdown is reached by setting the screen, and the pose is read after the
  // one advanced frame the spec allows it to ride.
  h.debug.setScreen("countdown");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "countdown");

  // `spawnBall` places the ball at its home point, held, with a full hold timer:
  // the arrangement the operation's own row states, read back with no frame in
  // between.
  const ball = ballOps(h);
  ball.spawnBall();
  const spawned = ball0(h.snapshot());
  assertEqual(spawned.held, true);
  assertCloseTo(spawned.holdTimer, HOLD_TIME, 6);
  assertEqual(spawned.spin, 0);

  // A paddle is put, given a driven velocity, and taken from the player, each by
  // its own operation. All three read back, and the paddle then stands where it
  // was put frame after frame rather than for one: a driven paddle moves at its
  // `drivenVy` alone, and this one's is zero.
  for (const [side, cy] of [
    ["left", LEFT_CY],
    ["right", RIGHT_CY],
  ] as const) {
    h.debug.setPaddleCy(side, cy);
    h.debug.setPaddleVy(side, 0);
    h.debug.setPaddleDriven(side, true);
  }
  await h.advance(24);
  const paddles = h.snapshot().paddles;
  assertCloseTo(paddles.left.cy, LEFT_CY, 3);
  assertCloseTo(paddles.right.cy, RIGHT_CY, 3);
  assertEqual(paddles.left.driven, true);
  assertEqual(paddles.right.driven, true);
  assertEqual(paddles.left.drivenVy, 0);
  assertEqual(paddles.right.drivenVy, 0);

  // The hold the spawn gave the ball is real and runs down through the game's
  // own countdown: within HOLD_TIME of the spawn the ball leaves its hold and
  // launches, with nothing on the surface serving it.
  const launched = await h.until((s) => !ball0(s).held, {
    maxFrames: Math.ceil(HOLD_TIME * TICK_HZ) + 12,
  });
  assertEqual(launched.hit, true);
  assertGreaterThan(ball0(launched.snapshot).speed, 0);

  // The remaining poses each set one field, and each is read straight back.
  h.debug.setMode("solo");
  h.debug.setMenuIndex(2);
  h.debug.setTitleIndex(1);
  h.debug.setResumeScreen("countdown");
  h.debug.setScore(3, 4);
  h.debug.setWinner("right");
  h.debug.setAiTracking(false);
  h.debug.setAiMovement(false);
  h.debug.setSeed(PROBE_SEED);
  const posed = h.snapshot();
  assertEqual(posed.mode, "solo");
  assertEqual(posed.menuIndex, 2);
  assertEqual(posed.titleIndex, 1);
  assertEqual(posed.resumeScreen, "countdown");
  assertDeepEqual(posed.score, { p1: 3, p2: 4 });
  assertEqual(posed.winner, "right");
  assertDeepEqual(posed.ai, { tracking: false, movement: false });
  assertEqual(posed.seed, PROBE_SEED);

  // And a reset returns the whole of it to the title-screen state specs/state.md
  // fixes, in one call: the screen, the score, the winner, both paddles — handed
  // back to the player, at rest, at the field's centre height — the AI's two
  // faculties, and the seed.
  h.debug.reset();
  await h.advance(1);
  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertEqual(title.menuIndex, 0);
  assertEqual(title.titleIndex, 0);
  assertEqual(title.resumeScreen, "playing");
  assertCloseTo(title.paddles.left.cy, FIELD_CY, 3);
  assertCloseTo(title.paddles.right.cy, FIELD_CY, 3);
  assertEqual(title.paddles.left.driven, false);
  assertEqual(title.paddles.right.driven, false);
  assertEqual(title.paddles.left.drivenVy, 0);
  assertEqual(title.paddles.right.drivenVy, 0);
  assertDeepEqual(title.ai, { tracking: true, movement: true });
  assertEqual(title.seed, DEFAULT_SEED);
  assertEqual(ball0(title).held, true);
  assertLength(title.obstacles, OBSTACLE_CENTERS.length);
  // `simTime` is restored to `0` with the rest, so what stands in it is the one
  // frame advanced since — however the reset's screen change landed. Two frames
  // of room, so neither reading is a failure.
  assertLessThanOrEqual(title.simTime, 2 / TICK_HZ);
});
