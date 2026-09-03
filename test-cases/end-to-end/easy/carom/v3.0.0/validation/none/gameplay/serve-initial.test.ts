// gameplay/serve-initial — the very first serve of a match travels toward player one.
//
// The match is opened the way a player opens one — menu keys at the title —
// because that route is this point's SUBJECT rather than a way in. Every posed
// route to a countdown reaches it through `reset`, whose title-screen state sets
// `receiver` to `left` (specs/state.md), so a check taking one would be reading
// a value the surface had just posed rather than the one the build's own
// match-start code chose. Entering through the menu is what leaves that decision
// to the build.
//
// The field is then emptied to the one held ball — a serve is about the ball and
// its aim, and nothing else takes any part in it — and the pre-serve hold is run
// out with `endHolds`, which touches nothing but the timer. The LAUNCH is the
// build's own, on the frame after, and the direction is read the instant it
// happens: before a wall or a paddle could have turned the ball around.
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
  endHolds,
  isolateBall,
  startWithKeys,
  type Harness,
  type Mode,
} from "../harness";

/**
 * Frames of the pre-serve hold recorded before the hold is expired.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: `endHolds` only expires the
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
      const opened = await harness.snapshot();
      assertEqual(opened.screen, "countdown");
      assertEqual(opened.mode, mode);

      // The world is cut down to the ball the serve is made of. The hold comes
      // back full, which is what a match start left it at anyway, and this check
      // measures the direction rather than the duration.
      await isolateBall(harness);

      await harness.advance(HELD_TICKS);
      await endHolds(harness);
      const launched = await harness.until((s) => s.screen === "playing", {
        maxFrames: 60,
        poll: 1,
      });
      // `launched` froze the launch frame, so the flight recorded here reaches
      // no assertion; the next mode opens from the title either way.
      await harness.advance(FLIGHT_TICKS);

      assertEqual(launched.hit, true);
      // Player one defends the LEFT edge, so a serve toward player one travels
      // left: a strictly negative horizontal velocity.
      assertLessThan(ball0(launched.snapshot).vx, 0);
    }
  });
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  assertDeepEqual(harness.pageErrors, []);
});
