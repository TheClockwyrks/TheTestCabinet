// Floe — presentation/hud-timer: the HUD carries the crossing timer, inside the
// bar, and the figure follows `timer`.
//
// specs/ui.md's HUD table: "Timer | The seconds left on the crossing timer,
// following `timer`", and of all five readouts "each is inside the bar", which
// specs/strait.md puts at `y` in `[0, HUD_H]` (`[0, 80]`). So what is decided
// here is that the seconds left are shown, inside the bar, and that the figure
// shown is the one the game holds — a build whose timer readout is frozen at the
// crossing's opening length gives a player no warning at all.
//
// THE TIMER IS POSED, AND NEVER RUN. `setTimerRunning` stays off throughout —
// `startCrossing` shuts it and nothing here reopens it — so this point reads the
// readout FOLLOWING THE FIELD rather than following the drain. That is what keeps
// it outside the closed list of items that turn a world gate on: the drain is
// `progression`'s to grade, the readout is this point's, and a build whose timer
// does not drain fails there and keeps this. It also means the figure read is
// exactly the figure posed, with no drift between the pose and the frame.
//
// THE FIGURE IS READ AS A NUMBER, NOT AS A STRING. specs/ui.md leaves the HUD's
// "arrangement and styling" to the build, so `TIME 22`, `22`, `0:22`, `22 / 30`
// and `22.0` all show the same seconds; `./hud.ts` reads every digit run the bar
// carries and this point asks whether the posed figure is among them. Both posed
// values are whole seconds, so a build that floors, rounds or ceilings its
// readout shows the same figure either way, and both are inside the level-1
// crossing length (`30` seconds, specs/progression.md) so a build that clamps its
// timer to the crossing's length shows them unchanged.
//
// THE TWO VALUES ARE CHOSEN SO NO OTHER READOUT CAN PRODUCE THEM. On the fresh
// level-1 crossing this poses, the other four readouts carry a score of `0`, `3`
// lives, `LEVEL 1 / 8`, and marks rather than digits for the bays. Neither `22`
// nor `7` is any of those. And once the timer is posed at `7`, a bar still
// carrying `22` is a readout that did not follow the field.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H } from "../constants";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { renderFrame } from "./frame";
import { hudNumbers, hudRuns } from "./hud";

/** The two values the timer is posed at, in seconds. */
const FIRST_TIMER = 22;
const SECOND_TIMER = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the timer at `seconds` and hand back the HUD bar's own figures. */
async function readHud(seconds: number): Promise<number[]> {
  h.debug.setTimer(seconds);
  const snapshot = h.snapshot();
  // The situation: the field really holds what was posed, and the drain really
  // is off, so what the readout is being asked to follow is this figure.
  assertEqual(
    snapshot.timer,
    seconds,
    "the posed crossing timer, read back (specs/instrumentation.md)",
  );
  assertEqual(
    snapshot.timerRunning,
    false,
    "the crossing timer held still while the readout is read " +
      "(specs/instrumentation.md)",
  );

  await renderFrame(h);
  assertGreaterThan(
    hudRuns(h).length,
    0,
    `the HUD bar to carry any readout at all with the timer at ${seconds} ` +
      `(specs/ui.md), read as the text runs anchored in y [0, ${HUD_H}] ` +
      `(specs/strait.md)`,
  );
  return hudNumbers(h);
}

it("draws the seconds left inside the HUD bar and follows the timer", async () => {
  startCrossing(h);

  const first = await readHud(FIRST_TIMER);
  const second = await readHud(SECOND_TIMER);
  // Before the assertions, so a failing verdict still leaves the readout that
  // produced it.
  captureStill(h, "hud");

  assertContains(
    first,
    FIRST_TIMER,
    `the numbers the HUD bar's readouts carry with the timer at ` +
      `${FIRST_TIMER} — the seconds left are drawn inside the bar ` +
      `(specs/ui.md)`,
  );
  assertContains(
    second,
    SECOND_TIMER,
    `the numbers the HUD bar's readouts carry with the timer at ` +
      `${SECOND_TIMER} — the readout follows the timer (specs/ui.md)`,
  );
  assertDeepEqual(
    second.filter((value) => value === FIRST_TIMER),
    [],
    `the readouts still carrying ${FIRST_TIMER} once the timer was posed at ` +
      `${SECOND_TIMER} — a readout that kept the old figure did not follow ` +
      `the timer (specs/ui.md)`,
  );
});
