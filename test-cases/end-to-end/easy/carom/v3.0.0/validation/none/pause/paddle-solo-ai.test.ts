// Carom — pause/paddle-solo-ai: while the game is paused, the AI's paddle does
// not move, even with a ball to chase.
//
// The AI is part of the simulation, so pausing must stop it exactly as it stops a
// held key and the ball. This poses the one situation in which a frozen AI and a
// running one look different — a ball crossing the field toward it, far from
// where its paddle is — and hands the right paddle back to the real opponent with
// `setAiControl`, so what is frozen is the build's own AI rather than a driver's
// held velocity.
//
// The chase is watched running first. Without that, a build whose AI never moved
// at all would pass the freeze for the wrong reason.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  STILL_MAX,
  arrangeAiChase,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the AI paddle still while paused", async () => {
  await arrangeAiChase(h, { paddleCy: 200, ballY: 620 });

  // The precondition: the real opponent is chasing, so a still paddle later is
  // the pause's doing.
  const start = h.snapshot().paddles.right.cy;
  await h.advance(36);
  expect(Math.abs(h.snapshot().paddles.right.cy - start)).toBeGreaterThan(
    STILL_MAX,
  );

  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");

  const paused = h.snapshot().paddles.right.cy;
  await h.advance(120);

  expect(h.snapshot().screen).toBe("paused");
  expect(Math.abs(h.snapshot().paddles.right.cy - paused)).toBeLessThan(
    STILL_MAX,
  );
});
