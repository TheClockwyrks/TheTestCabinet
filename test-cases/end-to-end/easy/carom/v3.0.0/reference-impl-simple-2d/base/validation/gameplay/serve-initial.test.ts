// gameplay/serve-initial — the very first serve of a match travels toward player one.
//
// The match is opened the way a player opens one — menu keys at the title, never
// `debug.startMatch` — because the case-provided `startMatch` sets `receiver`
// itself, so a check that used it would be reading the case's own answer back
// rather than the build's. Entering through the menu leaves the build's own
// match-start code to decide who receives.
//
// The pre-serve hold is then expired with `serve()`, which does not touch
// `receiver`; the LAUNCH is the build's own, on the frame after, and the
// direction is read the instant it happens — before a wall or a paddle could
// have turned the ball around.
//
// Both modes are checked: the serve direction is a rule of the match, not of the
// opponent, so a build that gets it right only in Versus fails here rather than
// passing on the mode that happened to be tested.

import { afterEach, beforeEach, expect, it } from "vitest";
import type { Mode } from "../../src/game";
import { createHarness, startWithKeys, type Harness } from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("serves toward player one to open a match", async () => {
  for (const mode of ["solo", "versus"] satisfies Mode[]) {
    await startWithKeys(harness, mode);
    // The menu keys really did open a match, so the launch below belongs to a
    // match this check started rather than to a title screen that never left.
    expect(harness.debug.snapshot().screen).toBe("countdown");
    expect(harness.debug.snapshot().mode).toBe(mode);

    harness.debug.serve();
    const launched = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });

    expect(launched.hit).toBe(true);
    // Player one defends the LEFT edge, so a serve toward player one travels
    // left: a strictly negative horizontal velocity.
    expect(launched.snapshot.ball.vx).toBeLessThan(0);
  }
  expect(harness.assetFailures).toEqual([]);
});
