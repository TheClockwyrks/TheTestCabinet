// gameplay/serve-initial — the very first serve of a match travels toward player one.
//
// The match is opened the way a player opens one — menu keys at the title, never
// `debug.startMatch` — because the specification has that operation set
// `receiver` itself, so a check that used it would be reading a pose the surface
// had just made rather than the build's own answer. Entering through the menu
// leaves the build's own match-start code to decide who receives.
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
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
  type Mode,
} from "../harness";

/**
 * Frames of the pre-serve hold recorded before the hold is expired.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: `serve()` only expires the
 * hold, the launch is still the build's own on the frame after it, and what
 * leaves a countdown is not a function of how long the countdown had been
 * running when it was cut short.
 */
const HELD_TICKS = 24; // 0.2 s

/**
 * Frames of the served flight recorded after the launch.
 *
 * The reading is taken on the launch frame — before a wall or a paddle could
 * change the ball — and that instant does not move. But a serve is only visible
 * as a serve once the ball has travelled, so the flight is driven after the
 * reading, inside the same recorded section, where it cannot reach an assertion.
 */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("serves toward player one to open a match", async () => {
  await captureReplay(harness, "serve", async () => {
    for (const mode of ["solo", "versus"] satisfies Mode[]) {
      await startWithKeys(harness, mode);
      // The menu keys really did open a match, so the launch below belongs to a
      // match this check started rather than to a title screen that never left.
      const opened = await harness.debug.snapshot();
      expect(opened.screen).toBe("countdown");
      expect(opened.mode).toBe(mode);

      await harness.advance(HELD_TICKS);
      await harness.debug.serve();
      const launched = await harness.until((s) => s.screen === "playing", {
        maxFrames: 60,
        poll: 1,
      });
      // `launched` froze the launch frame, so the flight recorded here reaches
      // no assertion; the next mode opens with `debug.reset()` either way.
      await harness.advance(FLIGHT_TICKS);

      expect(launched.hit).toBe(true);
      // Player one defends the LEFT edge, so a serve toward player one travels
      // left: a strictly negative horizontal velocity.
      expect(launched.snapshot.ball.vx).toBeLessThan(0);
    }
  });
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  expect(harness.pageErrors).toEqual([]);
});
