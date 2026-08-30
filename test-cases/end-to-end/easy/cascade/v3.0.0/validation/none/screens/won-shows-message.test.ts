// screens/won-shows-message — once the cascade is done, the `won` screen shows
// `WIN_TEXT`.
//
// `specs/screens.md`, the `won` screen: "The victory cascade runs over the table,
// and once it is done the screen shows `WIN_TEXT` (`YOU WIN`) over the painted
// table." `specs/victory.md` fixes when "done" is: "The cascade is done once all
// fifty-two cards have launched and no card is in flight", and
// `specs/instrumentation.md` reports that moment as `cascadeDone`, "the flag the
// cascade's own end test sets".
//
// SO THE CASCADE IS RUN, NOT POSED. `cascadeDone` is the cascade's own flag and
// `specs/instrumentation.md` is explicit that "Posed flyers retiring on a cleared
// table do not set it", so there is no shortcut to the state this item is about:
// the game is won through its own win path and then advanced until the flag
// turns. The wait runs off camera through `skip`, which closes no recorded frame,
// so the several seconds of launching cost the capture nothing; the frame the
// assertions read is driven afterwards, by `frameCalls`.
//
// It is the MESSAGE this item decides, and only that. The cadence, the arcs, the
// bounces and the trail are the `cascade` group's, the win itself is
// `winning/win-at-fifty-two`, and what a press does from here is
// `screens/won-press-deals`. The painted table underneath is what the captured
// frame shows a reviewer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WIN_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  openTable,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How long the cascade is given to finish, in seconds of game time.
 *
 * `specs/victory.md` fixes the launching at `LAUNCH_INTERVAL` (`0.18`) a card,
 * so the fifty-second card leaves at `51 * 0.18 = 9.18` s. It then flies until it
 * passes a side edge, and the slowest a launch can travel is
 * `LAUNCH_VX_MIN` (`180`) units a second; the longest crossing available to it is
 * from foundation `3` at `x = 956` leftwards off the stage, `1056` units, which
 * is `5.87` s. So `16` s covers the whole of the slowest cascade the
 * specification allows, with better than a third of it to spare.
 */
const CASCADE_SECONDS = 16;

/** How much game time each sample of the wait covers. */
const POLL_SECONDS = 0.5;

/**
 * Frames per second of game time during the wait.
 *
 * The wait is not the subject: what it has to do is run the game's own cascade to
 * its end. `specs/instrumentation.md` requires the simulation to be integrated
 * against whatever delta a frame supplies, so `120` Hz reaches the same end as
 * any other rate, and it halves the frames the wait costs.
 */
const WAIT_HZ = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the win message once the cascade has ended", async () => {
  await openTable(h);
  await startCascade(h);

  const ended = await h.skipUntil((s) => s.cascadeDone, {
    maxSeconds: CASCADE_SECONDS,
    pollSeconds: POLL_SECONDS,
    hz: WAIT_HZ,
  });

  const calls = await h.frameCalls();
  await captureStill(h, "won");

  assertEqual(
    ended.hit,
    true,
    `the cascade to report cascadeDone within ${CASCADE_SECONDS} s of game time (specs/victory.md)`,
  );
  assertEqual(
    ended.snapshot.screen,
    "won",
    "the screen the finished cascade left the game on (specs/screens.md)",
  );
  assertEqual(
    drewText(calls, WIN_TEXT),
    true,
    `the won screen draws "${WIN_TEXT}" once the cascade is done (specs/screens.md)`,
  );
});
