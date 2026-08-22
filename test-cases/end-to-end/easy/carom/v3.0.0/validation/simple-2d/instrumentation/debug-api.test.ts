// Carom — instrumentation/debug-api: the build exposed its debug and automation
// surface through the runtime, and that surface is whole and really backed by the
// state the build declared.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S.
//
// The first is the one line `src/game.ts` owes: `initialize` builds the surface
// over the state it just built and hands it to the runtime with
// `api.debug.expose(createDebugApi(state))` (specs/instrumentation.md). Nothing
// else can do it — the runtime accepts a surface during initialization and at no
// other moment — and a build that skips it leaves `engine.debug` throwing, with
// no way for a check to reach the game at all. That is what the first check below
// establishes, reading the surface off the runtime the harness constructed.
//
// The second is the state behind it. `src/debug.ts` is the case's own module, so
// the operations exist in every build by construction; what is the build's is that
// `CaromState` still holds what those operations read and pose. A build that
// hollowed out a field, renamed one, or stopped honouring the driver's hold over
// the paddles exposes a surface that is present and useless, and that is what a
// snapshot read off a real, driven match catches.
//
// The clock, the keyboard, and the overlay are the runtime's under this runtime,
// so the surface carries no operation for any of them (specs/instrumentation.md
// strikes `step`, `setAutoStep`, `keyDown`, `keyUp` and `press`), and demanding
// them here would fail a perfectly conformant build. What remains is the list
// below: the reads, and the control operations that pose a scenario in the game's
// own world.
//
// Every other automated item drives this surface to pose its own scenario, so an
// unexposed surface or a state the build reshaped also shows up as those items
// failing to run. This one names the fault plainly.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, HOLD_TIME } from "../../src/constants";
import { CAROM_DEBUG_VERSION } from "../../src/debug";
import {
  ball0,
  captureStill,
  createHarness,
  holdTimer0,
  startPlaying,
  type Harness,
} from "../harness";

/** Every operation the surface must carry under this runtime. */
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

it("hands its debug surface to the runtime from initialize", () => {
  // `engine.debug` throws in a build whose `initialize` never called
  // `api.debug.expose`, so reading it is the check: there is no page property to
  // look for and nothing the harness could have supplied in the build's place.
  expect(() => h.engine.debug).not.toThrow();

  // The runtime returns the value the game handed over, unchanged and unwrapped,
  // so every read is the same object and it is the one the rest of this suite —
  // and every other check in this directory — poses the game through.
  expect(h.engine.debug).toBe(h.debug);
  expect(h.engine.debug).toBe(h.engine.debug);
  expect(typeof h.engine.debug).toBe("object");
});

it("carries a version and every required operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  expect(typeof api.version).toBe("number");
  expect(api.version).toBe(CAROM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op]).toBe("function");
  }
});

it("reports the whole documented snapshot shape, from a live match", async () => {
  await startPlaying(h, "versus");
  await h.advance(36); // 0.3 s of real flight, so the reads are of live play
  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so the two can be held against each other.
  captureStill(h, "state");

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
    expect(typeof ball0(snapshot)[field]).toBe("number");
  }
  expect(typeof ball0(snapshot).held).toBe("boolean");
  expect(typeof snapshot.simTime).toBe("number");

  // Live values, not a shape filled with zeroes: the ball is in flight, so it is
  // no longer held and it is moving at the speed its serve gave it.
  expect(snapshot.screen).toBe("playing");
  expect(ball0(snapshot).held).toBe(false);
  expect(ball0(snapshot).speed).toBeGreaterThan(0);
  expect(ball0(snapshot).speed).toBeCloseTo(
    Math.hypot(ball0(snapshot).vx, ball0(snapshot).vy),
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
  expect(ball0(opened).held).toBe(true);
  expect(holdTimer0(h)).toBeGreaterThan(0);
  expect(holdTimer0(h)).toBeLessThanOrEqual(HOLD_TIME);

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
