// gameplay/serve-initial — the very first serve of a match travels toward player one.
//
// The match is opened the way a player opens one — menu keys at the title, never
// a posed screen — because opening a countdown through the debug surface sets
// `receiver` itself, so a check that did would be reading the case's own answer
// back rather than the build's. Entering through the menu leaves the build's own
// match-start code to decide who receives.
//
// The pre-serve hold is then cut to zero, which touches the hold's remaining
// seconds and nothing else; the LAUNCH is the build's own, on the frame after,
// and the direction is read the instant it happens — before a wall or a paddle
// could have turned the ball around.
//
// THE FIELD HOLDS THE ONE HELD BALL AND NOTHING ELSE. The obstacles come off
// before the hold is cut, so the flight recorded after the reading is a serve
// travelling rather than a serve banking off furniture this point never aimed at.
// Clearing the field and spawning the ball back says nothing about `receiver`:
// the ball returns to its home point held, and which way it then leaves is still
// the build's own. Neither paddle is taken from anyone.
//
// Both modes are checked: the serve direction is a rule of the match, not of the
// opponent, so a build that gets it right only in Versus fails here rather than
// passing on the mode that happened to be tested.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  isolateField,
  reachPlay,
  startWithKeys,
  type Harness,
} from "../harness";
import type { Mode } from "../surface";

/**
 * Frames of the pre-serve hold recorded before the hold is cut short.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: cutting the hold to zero
 * only expires it, the launch is still the build's own on the frame after, and
 * what leaves a countdown is not a function of how long the countdown had been
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

afterEach(() => {
  harness?.dispose();
});

it("serves toward player one to open a match", async () => {
  await captureReplay(harness, "serve", async () => {
    for (const mode of ["solo", "versus"] satisfies Mode[]) {
      await startWithKeys(harness, mode);
      // The menu keys really did open a match, so the launch below belongs to a
      // match this check started rather than to a title screen that never left.
      assertEqual(harness.snapshot().screen, "countdown");
      assertEqual(harness.snapshot().mode, mode);
      isolateField(harness);

      await harness.advance(HELD_TICKS);
      const launched = await reachPlay(harness);
      // `launched` froze the launch frame, so the flight recorded here reaches
      // no assertion; the next mode opens from the title either way.
      await harness.advance(FLIGHT_TICKS);

      assertEqual(launched.hit, true);
      // Player one defends the LEFT edge, so a serve toward player one travels
      // left: a strictly negative horizontal velocity.
      assertLessThan(ball0(launched.snapshot).vx, 0);
    }
  });
  assertDeepEqual(harness.assetFailures, []);
});
