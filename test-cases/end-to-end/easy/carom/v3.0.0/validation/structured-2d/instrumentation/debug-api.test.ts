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
// The clock, the keyboard, and the overlay are the engine's under this engine,
// so the surface carries no operation for any of them (specs/instrumentation.md),
// and demanding one here would fail a perfectly conformant build. What it does
// carry is the list in `surface.ts`: the reads, and the control operations that
// pose a scenario in the game's own world.
//
// Every other automated item drives this surface to pose its own scenario, so a
// missing surface or an operation that does not act also shows up as those
// items failing to run. This one names the fault plainly.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, HOLD_TIME } from "../../src/constants";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  ball0,
  captureStill,
  createHarness,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";
import { CAROM_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

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

  // A pose returns nothing and acts on the live game, and a pose whose effect
  // is a level transition is honored at the end of the next advanced frame
  // (specs/instrumentation.md): until that frame runs, the running game still
  // reports the title…
  api.startMatch("versus");
  assertEqual(api.snapshot().screen, "title");
  // …and the frame that follows opens the match.
  await h.advance(1);
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

it("poses the running game through the same systems play uses", async () => {
  // A match opens on the pre-serve countdown, with the ball held.
  h.debug.startMatch("versus");
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  // A posed paddle stays where it was put, and a posed velocity persists across
  // frames rather than being a one-frame nudge.
  h.debug.setPaddle("left", { cy: 200, vy: 0 });
  h.debug.setPaddle("right", { cy: 500, vy: 0 });
  await h.advance(24);
  assertCloseTo(h.snapshot().paddles.left.cy, 200, 3);
  assertCloseTo(h.snapshot().paddles.right.cy, 500, 3);

  // A posed score is the score.
  h.debug.setScore(3, 4);
  await h.advance(1);
  assertDeepEqual(h.snapshot().score, { p1: 3, p2: 4 });

  // The hold the match opened with is real and runs down through the game's own
  // countdown: within HOLD_TIME of the opening, the ball leaves its hold and
  // launches, with no serve() called.
  const launched = await h.until((s) => !ball0(s).held, {
    maxFrames: Math.ceil(HOLD_TIME * TICK_HZ) + 12,
  });
  assertEqual(launched.hit, true);

  // And a reset returns the whole of it to the title.
  h.debug.reset();
  await h.advance(1);
  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
  assertCloseTo(title.paddles.left.cy, FIELD_CY, 3);
  assertCloseTo(title.paddles.right.cy, FIELD_CY, 3);
});
