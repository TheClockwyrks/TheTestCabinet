// pause/ball-continues — after unpausing, the ball carries on from exactly
// where it was suspended.
//
// specs/ui.md: on `paused`, `back` resumes to `resumeScreen`, and each update
// reads input first, then advances the screen the input left it on. So the
// frame that delivers the resume is itself a `playing` frame, and it moves the
// ball from its paused position by its preserved velocity times `dt`. The
// fault this catches is a build that treats resuming as a fresh start: a
// re-serve, or a jump back to the center.
//
// The ball is posed in mid-flight, clear of the obstacles so its path is a
// straight line, frozen, confirmed still, and resumed with one real Escape
// press; where it is after that one frame is read against the paused position
// plus `v * dt`, within `MAX_SUBSTEP`, the most a sub-step moves the ball. A
// teleport is a hundred units out and misses that by any measure.

import { afterEach, beforeEach, expect, it } from "vitest";
import { MAX_SUBSTEP } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Frames of flight before the pause, so the ball is demonstrably moving. */
const FLIGHT_TICKS = 30; // 0.25 s
/** Frames held paused, most of them before the recording opens. */
const FROZEN_TICKS = 120; // 1 s
const HANGING_TICKS = 48; // 0.4 s
/** Frames of the resumed flight recorded after the read, for the replay. */
const RESUMED_TICKS = 24; // 0.2 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the ball from its paused position at its preserved velocity", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });

  await h.advance(FLIGHT_TICKS);
  await h.tap("Escape");
  const paused = await h.snapshot();
  expect(paused.screen).toBe("paused");

  await h.advance(FROZEN_TICKS - HANGING_TICKS);

  const read = await captureReplay(h, "continues", async () => {
    await h.advance(HANGING_TICKS);
    // The end of the freeze, read on exactly the frame it was read on before.
    const still = await h.snapshot();

    await h.tap("Escape"); // resume: one frame, and a playing one
    const resumed = await h.snapshot();
    await h.advance(RESUMED_TICKS);
    return { still, resumed };
  });
  expect(ball0(read.still).x).toBeCloseTo(ball0(paused).x, 6);
  expect(ball0(read.still).y).toBeCloseTo(ball0(paused).y, 6);

  expect(read.resumed.screen).toBe("playing");
  const dt = 1 / TICK_HZ;
  const expectedX = ball0(paused).x + ball0(paused).vx * dt;
  const expectedY = ball0(paused).y + ball0(paused).vy * dt;
  expect(Math.abs(ball0(read.resumed).x - expectedX)).toBeLessThanOrEqual(
    MAX_SUBSTEP,
  );
  expect(Math.abs(ball0(read.resumed).y - expectedY)).toBeLessThanOrEqual(
    MAX_SUBSTEP,
  );
  expect(ball0(read.resumed).speed).toBeCloseTo(ball0(paused).speed, 6);
});
