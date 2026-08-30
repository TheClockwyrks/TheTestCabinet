// hud/core-countdown — a carried Sample's countdown is drawn and falls.
//
// `specs/ui.md`: the Core Sample countdown is drawn prominently over the world
// while a Sample is carried. `specs/hazards.md` fixes the timer it counts —
// `CORE_TIMER` (`90`) seconds, counting down in game time and never pausing while
// the expedition runs.
//
// So the frame's own text runs over the mine viewport are read and asked for the
// figure the snapshot reports, and then the same reading is taken again after a
// span of game time and must have fallen by that span. The countdown is read as
// either a plain count of seconds or `m:ss`, because `specs/ui.md` fixes the
// countdown and not its format, and those are the two ways a countdown is
// written. The jettison hint beside it carries no fixed copy, so nothing here
// asserts its words.
//
// The miner stands on a laid floor in a cleared mine with its drill held, so
// nothing but the timer is running.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";
import { countdownOf, countdownRuns, worldText } from "./bar";

const ROW = 100;
const COL = PLAYABLE_COL_MIN + 8;

/** The span the timer is watched over, and the frames it is run in. */
const WATCH_SECONDS = 12;
const WATCH_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the countdown over the world and falls with the timer", async () => {
  openScene(h);
  layFloor(h, ROW);
  pinDrill(h);
  standOn(h, COL, ROW);
  h.debug.setCoreCarried(true);

  const seen = await captureReplay(h, "countdown", async () => {
    const opened = h.snapshot();
    const first = countdownRuns(await worldText(h), opened.coreTimer ?? 0);
    await h.advanceSeconds(WATCH_SECONDS, WATCH_FRAMES);
    const later = h.snapshot();
    const second = countdownRuns(await worldText(h), later.coreTimer ?? 0);
    return {
      opened: opened.coreTimer ?? 0,
      later: later.coreTimer ?? 0,
      first: first.map((run) => countdownOf(run) ?? 0),
      second: second.map((run) => countdownOf(run) ?? 0),
    };
  });

  assertEqual(Math.round(seen.opened), CORE_TIMER, "specs/hazards.md");
  assertGreaterThan(seen.first.length, 0, "specs/ui.md");
  assertGreaterThan(seen.second.length, 0, "specs/ui.md");
  assertLessThan(
    Math.max(...seen.second),
    Math.min(...seen.first),
    "specs/ui.md",
  );
});
