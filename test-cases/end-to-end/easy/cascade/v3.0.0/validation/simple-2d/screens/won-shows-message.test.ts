// screens/won-shows-message — once the victory cascade is done, the won screen
// says so.
//
// THE RULE. specs/screens.md's `won` section: "The victory cascade runs over the
// table, and once it is done the screen shows `WIN_TEXT` (`YOU WIN`) over the
// painted table." specs/victory.md fixes when that moment arrives: "The cascade is
// done once all fifty-two cards have launched and no card is in flight", and
// specs/instrumentation.md reports it as the snapshot's `cascadeDone`, "the flag
// the cascade's own end test sets".
//
// SO THE CASCADE IS RUN, NOT POSED. `cascadeDone` is not a field any operation
// sets: it is the cascade's own verdict on itself, and a build is entitled to hold
// `WIN_TEXT` back until it is raised. A check that posed the `won` screen and read
// the frame immediately would fail a build doing exactly what the specification
// asks. So the win is reached through the game's own move path
// ({@link startCascade}: fifty-one cards home and the fifty-second sent home from
// the table), and the cascade is then run out in real frames until the build's own
// flag says it is finished.
//
// THE TRAIL IS LEFT PAINTING. specs/victory.md has each card in flight stamp
// itself onto the painted layer, and specs/screens.md puts the message "over the
// painted table" — so the still beside this verdict is the frame a player really
// sees at the end of a game, felt buried under fifty-two cards' worth of stamps.
//
// MATCHED BY SUBSTRING, IGNORING CASE ({@link drewText}). The literal is the
// case's; how a build presents it is the build's.
//
// WHAT THIS DOES NOT DECIDE. Anything about the cascade itself — the launch
// cadence, the arc, the bounce, the trail and the end test are the `cascade` and
// `winning` groups' — nor what a press does once the message is up, which is
// `screens/won-press-deals`.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_TEXT } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";

/**
 * The longest a conforming cascade can take to finish, in seconds of game time.
 *
 * Every figure is specs/victory.md's. Fifty-two cards launch at
 * `LAUNCH_INTERVAL` (`0.18` s), the first on the cascade's first frame, so the
 * last one leaves the foundations `51 x 0.18` = `9.18` s in. It then has to cross a
 * side edge to retire, and the farthest crossing is from the right-most foundation
 * anchor (`x = 956`, specs/table.md) leftwards past `x + CARD_W < 0`, which is
 * `1056` units, at the slowest speed the launch can draw, `LAUNCH_VX_MIN` (`180`):
 * `5.87` s. So `15.05` s bounds it, and `18` leaves margin for the frame the sweep
 * happens to sample on. A build still flying at that point has not finished a
 * cascade; it has one that does not end.
 */
const CASCADE_LIMIT = 18;

/**
 * Frames between two samples of the sweep: a quarter-second of game time.
 *
 * Far finer than anything this point measures — it reads a flag, not a moment — and
 * coarse enough that the sweep is not asking the build for a snapshot four thousand
 * times over.
 */
const POLL = framesFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws WIN_TEXT once the cascade has reported itself done", async () => {
  startCascade(h);
  assertEqual(
    h.snapshot().screen,
    "won",
    "posing: the screen the last card home reached, which is where the " +
      "cascade runs (specs/victory.md, specs/screens.md)",
  );

  const swept = await h.until((snapshot) => snapshot.cascadeDone, {
    maxFrames: framesFor(CASCADE_LIMIT),
    poll: POLL,
  });
  assertEqual(
    swept.hit,
    true,
    `the cascade reporting itself done within ${CASCADE_LIMIT} s of game ` +
      "time, which bounds fifty-two launches at LAUNCH_INTERVAL and the last " +
      "card's crossing at LAUNCH_VX_MIN (specs/victory.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "won");

  assertEqual(
    drewText(calls, WIN_TEXT),
    true,
    `the won screen's frame drawing WIN_TEXT (${WIN_TEXT}) once the cascade ` +
      "is done (specs/screens.md)",
  );
});
