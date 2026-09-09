// progression/victory-on-level-8 — the hop that fills the last open bay of the
// LAST level wins the run there and then.
//
// specs/progression.md: "At `TOTAL_LEVELS`: the run is won on that hop, and the
// screen becomes `victory`." specs/bays.md fixes which hop that is: "A level is
// cleared by the hop that fills its last open bay."
//
// TWO HOPS ARE TAKEN AT LEVEL 8, ALIKE IN EVERY WAY BUT ONE. Both are ordinary
// completing hops into bay `2` of a level-`TOTAL_LEVELS` strait; the only
// difference is how many bays already stood filled behind them. The control
// leaves one bay open afterwards, so the level is not cleared and the run must
// still be under way; the measurement leaves none, so the level's last bay has
// been filled and the run is won. Without the control this point would pass a
// build that ended the run on ANY bay filled at level 8, or on reaching level 8
// at all — both of which read `victory` on the measurement alone.
//
// THE WIN IS READ ON THE TICK THE HOP LANDED, before anything runs on, because
// "the run is won on that hop": specs/progression.md gives the victory no hold at
// all, unlike the `clearing` a level below `TOTAL_LEVELS` ends in, so a build
// that held first and won later has not done what the specification says. A
// quarter of a second is recorded afterwards for the replay alone.
//
// FOUR BAYS ARE POSED FILLED AND THE FIFTH IS HOPPED INTO, because posing the
// fifth as well would clear nothing (`bays/posed-full-does-not-clear`). The open
// one is bay `2`, the middle of the five, so a build that only notices its first
// or its last bay fails here rather than passing by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT, HOP_KEY, TOTAL_LEVELS } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The last level of the run, which is the only level a hop can win on. */
const LEVEL = TOTAL_LEVELS;

/** The bay both hops end in — the middle of the five. */
const OPEN_BAY = 2;

/**
 * The bays posed filled in each half.
 *
 * The control leaves bay `4` open behind it as well as `OPEN_BAY`, so its hop
 * fills the fourth of five and the level is still being played; the measurement
 * leaves only `OPEN_BAY`, so its hop fills the last.
 */
const CONTROL_FILLED: readonly number[] = [0, 1, 3];
const WINNING_FILLED: readonly number[] = [0, 1, 3, 4];

/** Every bay filled, which is what the winning hop leaves behind. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);

/** Ticks recorded after each hop, for the replay alone. */
const AFTER_TICKS = ticksFor(0.25);

let h: Harness;

/** Pose a level-8 strait with `filled` bays already filled, at bay `OPEN_BAY`'s mouth. */
async function poseLevelEight(filled: readonly number[]): Promise<void> {
  await startCrossing(h, LEVEL);
  for (const bay of filled) await h.debug.setBay(bay, true);
  await poseAtBayMouth(h, OPEN_BAY);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wins the run on the hop that fills the last open bay of level eight", async () => {
  // The control: the same hop at the same level, with one bay left open behind
  // it, so the level is not cleared and the run is still being played.
  await poseLevelEight(CONTROL_FILLED);
  await h.tap(HOP_KEY.up);
  const control = await h.snapshot();
  assertEqual(
    control.bays[OPEN_BAY],
    true,
    `bay ${OPEN_BAY} filled by that hop`,
  );
  assertEqual(control.bays[4], false, "a bay still open behind that hop");
  assertEqual(
    control.screen,
    "playing",
    `level ${LEVEL} is not won while a bay is still open`,
  );

  // The measurement: the same hop with the other four filled, so it fills the
  // last open bay of the last level.
  await poseLevelEight(WINNING_FILLED);

  const posed = await h.snapshot();
  assertEqual(posed.level, LEVEL, "the last level of the run");
  assertEqual(posed.screen, "playing", "four posed bays win nothing");

  const won = await captureReplay(h, "victory", async () => {
    await h.tap(HOP_KEY.up);
    const landed = await h.snapshot();
    await h.advance(AFTER_TICKS);
    return landed;
  });

  assertDeepEqual(won.bays, ALL_FILLED, "the last open bay filled by that hop");
  assertEqual(
    won.screen,
    "victory",
    `the run won on the hop that cleared level ${LEVEL} (specs/progression.md)`,
  );
});
