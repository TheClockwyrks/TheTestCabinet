// instrumentation/reset-shows-the-title-screen — a reset returns the game to its
// title state, so whatever screen was showing, the title screen shows after it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: the `title`
// screen with `menuIndex` `0`, site `0` open, …". The screen is the first field
// that sentence names, and this check decides that one.
//
// THE SCENARIO STANDS WHERE A RESET HAS THE MOST TO UNDO: the run screen, with a
// run in progress. A reset that simply did nothing, or that only tidied the yard
// screens, is caught there and nowhere else. The run screen is reached the way
// the game reaches it — `startRun` "poses the `run` action: the same refusals,
// the same `run-start`, and the same move to the run screen" — rather than by
// pressing a key on a menu, so a build with a broken menu still fails only its
// menu items.
//
// The world is emptied first and stood up with the minimal crane and a one-step
// tape, because nothing about this requirement concerns the crane, the yard, or
// what the tape does: they are here only so that a run can legally begin.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: enough for a run to legally start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the title screen after a reset taken from a run in progress", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  assertEqual(
    (await h.snapshot()).screen,
    "run",
    "the screen a started run moves to, the screen the reset is taken from",
  );

  await h.debug.reset();
  const screen = (await h.snapshot()).screen;
  await h.advance(1);
  await h.capture("title", "The screen a reset leaves showing");

  assertEqual(
    screen,
    "title",
    "the screen a reset leaves (specs/instrumentation.md)",
  );
});
