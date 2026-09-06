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
import { drewText } from "../case-harness/index";
import {
  CARD_W,
  DECK_SIZE,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MIN,
  STAGE_W,
  WIN_TEXT,
} from "../constants";
import {
  RUNOUT_HZ,
  captureStill,
  createHarness,
  openTable,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How long the cascade is given to finish, in seconds of game time.
 *
 * A BOUND ON THE WAIT, not a reading of it: nothing below asserts how long a
 * cascade took, only that it ended and what the screen shows once it has. It is
 * arithmetic over the figures `specs/victory.md` fixes, and it over-pays at both
 * ends deliberately.
 *
 * The launching: `DECK_SIZE` (`52`) cards `LAUNCH_INTERVAL` (`0.18`) apart is
 * `9.36` s. The last card in fact leaves at `51 * 0.18 = 9.18` s, so the term is
 * already one interval generous.
 *
 * The flight: a launched card's `vx` never changes — `specs/victory.md` gives a
 * card in flight no collision, "not the side edges" — so its time in the air is
 * decided by the horizontal crossing alone, and the gravity, the bounces and the
 * damping cost it nothing. The widest crossing on the stage is `STAGE_W + CARD_W`
 * (`1380`) units and the slowest launch the specification allows is
 * `LAUNCH_VX_MIN` (`180`) units a second: `7.67` s. That over-pays too, because a
 * card starts at a foundation anchor rather than at an edge, and the furthest of
 * the four (`x = 956`, leftwards) has only `1056` units to cover.
 *
 * Together, `17.03` s against a true worst case of `9.18 + 1056 / 180 = 15.05` s
 * — close to two seconds of slack. Written as the expression rather than as its
 * value so it follows the constants if a figure moves, and matching the same
 * bound the `cascade` group takes for the same wait.
 */
const CASCADE_SECONDS =
  DECK_SIZE * LAUNCH_INTERVAL + (STAGE_W + CARD_W) / LAUNCH_VX_MIN;

/** How much game time each sample of the wait covers. */
const POLL_SECONDS = 0.5;

/**
 * Frames per second of game time during the wait.
 *
 * The wait is not the subject: what it has to do is run the game's own cascade to
 * its end. `specs/instrumentation.md` requires the simulation to be integrated
 * against whatever delta a frame supplies, so the project's shared
 * {@link RUNOUT_HZ} reaches the same end as any other rate at a quarter of the
 * frames — which is what keeps this point's cost the build's rather than the
 * host's.
 */
const WAIT_HZ = RUNOUT_HZ;

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
    `the cascade to report cascadeDone within ${CASCADE_SECONDS.toFixed(2)} s of game time (specs/victory.md)`,
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
