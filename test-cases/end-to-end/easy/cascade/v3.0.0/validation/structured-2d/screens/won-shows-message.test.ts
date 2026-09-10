// screens/won-shows-message — the won screen shows YOU WIN once the cascade ends.
//
// specs/screens.md: on `won`, "the victory cascade runs over the table, and once
// it is done the screen shows `WIN_TEXT` (`YOU WIN`) over the painted table."
// specs/victory.md fixes when that moment arrives: "The cascade is done once all
// fifty-two cards have launched and no card is in flight", and the painted table
// stays behind the message. It is the only ending this game has.
//
// THE WIN AND THE CASCADE ARE THE GAME'S OWN. `startCascade` poses a board one
// legal move from winning and then makes that move through the game's own `move`
// (specs/instrumentation.md), so the win test, the move to `won` and every one of
// the fifty-two launches happen because the build decided they should. The
// cascade is then run to ITS OWN end flag rather than for a fixed span, because
// how long the last card takes to cross the table depends on the horizontal speed
// the build's generator drew for it.
//
// THE TRAIL IS LEFT PAINTING, which the `cascade` group's checks turn off: the
// message is drawn "over the painted table", and the still this point captures is
// the evidence a reviewer reads that from.
//
// THE RUN-OUT IS STEPPED AT `RUNOUT_HZ`. Nothing this point reads is quantised to
// a frame — the cascade's own end flag, the screen it left up, and the text of the
// frame after it — and where a cascade ends is not a frame-rate quantity either:
// the launch clock adds each frame's delta and a card retires on an `x` that
// advances by `vx * dt`, so the ending falls at the same game time however the
// twenty seconds are cut. What the finer clock would buy is nothing, and what it
// costs is four times the renders of a table carrying up to fifty-two cards. See
// `RUNOUT_HZ`, whose argument this is.
//
// ONE REQUIREMENT: the message. That the cascade reaches its end at all is
// `cascade/cascade-completes`, and that the paint survives it is
// `cascade/trail-survives-completion`; a build that never finishes cannot draw
// this message either, so the run below reports the unfinished cascade as what it
// found rather than passing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import { WIN_TEXT } from "../constants";
import { captureStill, startCascade, type Harness } from "../harness";
import { createRunoutHarness, runoutFrames } from "../cascade/flight";

/**
 * How long the cascade is given to run out, in frames of the run-out clock.
 *
 * The fifty-second launch falls fifty-one launch intervals in — a little over
 * nine seconds at the `LAUNCH_INTERVAL` (`0.18`) specs/victory.md fixes — and the
 * slowest launch the `[180, 420]` range allows then needs under four more to
 * cross the table from the farthest foundation. Twenty seconds is comfortably
 * past both, and short enough that a build that never finishes is reported rather
 * than left running.
 */
const MAX_FRAMES = runoutFrames(20);

let h: Harness;

beforeEach(async () => {
  h = await createRunoutHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws WIN_TEXT once the victory cascade is done", async () => {
  startCascade(h);

  const run = await h.until((seen) => seen.cascadeDone, {
    maxFrames: MAX_FRAMES,
  });
  assertEqual(
    run.snapshot.cascadeDone,
    true,
    "the cascade's own end flag within twenty seconds of the win, which is " +
      "when the message is owed (specs/victory.md)",
  );
  assertEqual(
    run.snapshot.screen,
    "won",
    "the screen the finished cascade left up, which is the screen the " +
      "message is drawn on (specs/screens.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "won");

  assertEqual(
    drewText(calls, WIN_TEXT),
    true,
    `the frame after the cascade to draw WIN_TEXT (${JSON.stringify(
      WIN_TEXT,
    )}) over the painted table (specs/screens.md)`,
  );
});
