// Carom — instrumentation/debug-api: the debug and automation surface is present,
// whole, and really backed by the state the build declared.
//
// `src/debug.ts` is the case's own module, so the operations exist in every build
// by construction. What this item establishes is the half that is the build's:
// that `CaromState` still holds what the surface reads and poses. A build that
// hollowed out a field, renamed one, or stopped honouring the driver's hold over
// the paddles produces a surface that is present and useless, and that is what a
// snapshot read off a real, driven match catches.
//
// The clock, the keyboard, and the overlay are the engine's under this engine, so
// `window.__carom` carries no operation for any of them (specs/instrumentation.md
// strikes `step`, `setAutoStep`, `keyDown`, `keyUp` and `press`), and demanding
// them here would fail a perfectly conformant build. What remains is the list
// below: the reads, and the control operations that pose a scenario in the game's
// own world.
//
// Every other automated item drives this surface to pose its own scenario, so a
// state the build reshaped also shows up as those items failing to run. This one
// names the fault plainly.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, HOLD_TIME } from "../../src/constants";
import { CAROM_DEBUG_VERSION } from "../../src/debug";
import { createHarness, startPlaying, type Harness } from "../harness";

/** Every operation the surface must carry under this engine. */
const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "startMatch",
  "serve",
  "setScore",
  "setPaddle",
  "setBall",
  "setAiControl",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries a version and every required operation, as functions", () => {
  const api = h.debug as unknown as Record<string, unknown>;

  expect(typeof api.version).toBe("number");
  expect(api.version).toBe(CAROM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op]).toBe("function");
  }
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await startPlaying(h, "versus");
  await h.advance(36); // 0.3 s of real flight, so the reads are of live play

  const snapshot = h.snapshot();

  expect(typeof snapshot.version).toBe("number");
  expect([
    "title",
    "howto",
    "countdown",
    "playing",
    "paused",
    "matchover",
  ]).toContain(snapshot.screen);
  expect(["solo", "versus"]).toContain(snapshot.mode);
  expect(typeof snapshot.score.p1).toBe("number");
  expect(typeof snapshot.score.p2).toBe("number");
  expect(snapshot).toHaveProperty("winner");
  expect(typeof snapshot.muted).toBe("boolean");

  for (const side of ["left", "right"] as const) {
    expect(typeof snapshot.paddles[side].cy).toBe("number");
    expect(typeof snapshot.paddles[side].vy).toBe("number");
  }

  for (const field of ["x", "y", "vx", "vy", "speed", "spin"] as const) {
    expect(typeof snapshot.ball[field]).toBe("number");
  }
  expect(typeof snapshot.ball.held).toBe("boolean");
  expect(typeof snapshot.simTime).toBe("number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held and it is moving at the speed its serve gave it.
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.ball.held).toBe(false);
  expect(snapshot.ball.speed).toBeGreaterThan(0);
  expect(snapshot.ball.speed).toBeCloseTo(
    Math.hypot(snapshot.ball.vx, snapshot.ball.vy),
    6,
  );
  expect(snapshot.simTime).toBeGreaterThan(0);
});

it("poses the game through the state the build declared", async () => {
  // A match opens on the pre-serve countdown, with the ball held at the centre.
  h.debug.startMatch("versus");
  await h.advance(1);
  const opened = h.snapshot();
  expect(opened.screen).toBe("countdown");
  expect(opened.ball.held).toBe(true);
  expect(h.state.holdTimer).toBeGreaterThan(0);
  expect(h.state.holdTimer).toBeLessThanOrEqual(HOLD_TIME);

  // A posed paddle stays where it was put, and a posed velocity persists across
  // frames rather than being a one-frame nudge.
  h.debug.setPaddle("left", { cy: 200, vy: 0 });
  h.debug.setPaddle("right", { cy: 500, vy: 0 });
  await h.advance(24);
  expect(h.snapshot().paddles.left.cy).toBeCloseTo(200, 3);
  expect(h.snapshot().paddles.right.cy).toBeCloseTo(500, 3);

  // A posed score is the score.
  h.debug.setScore(3, 4);
  await h.advance(1);
  expect(h.snapshot().score).toEqual({ p1: 3, p2: 4 });

  // And a reset returns the whole of it to the title.
  h.debug.reset();
  await h.advance(1);
  const title = h.snapshot();
  expect(title.screen).toBe("title");
  expect(title.score).toEqual({ p1: 0, p2: 0 });
  expect(title.winner).toBeNull();
  expect(title.paddles.left.cy).toBeCloseTo(FIELD_CY, 3);
  expect(title.paddles.right.cy).toBeCloseTo(FIELD_CY, 3);
});
