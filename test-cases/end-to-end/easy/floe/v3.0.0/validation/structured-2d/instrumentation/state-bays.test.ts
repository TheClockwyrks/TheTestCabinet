// Floe — instrumentation/state-bays: the five bays and the bonus catch are
// reported and read back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// frame would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// `bays` IS READ AS FIVE ENTRIES, not as "an array". `specs/strait.md` cuts
// `BAY_COUNT` bays into the far shore and `specs/ui.md` gives the HUD one mark
// per bay "in the bays' own left-to-right order", so a build reporting four or
// six is reporting a strait a player cannot finish, and the length is part of
// the shape rather than a detail of it.
//
// AND THE BONUS CATCH IS READ BOTH WAYS. `fishBay` is a bay index or `null`, so
// a build that reports the index and never clears it hides a catch that has left
// the strait: `setFishBay` and `clearFish` are two operations and both of their
// answers are read here.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
/** The bay posed both ways, and the bay the bonus catch is posed into. */
const BAY = 2;
const FISH_BAY = 4;

/** The bay posed filled, and the bay the posed bonus catch sits in. */
const FILLED_BAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the bays and the bonus catch and reads every pose of them back", async () => {
  startCrossing(h);
  h.debug.setBay(FILLED_BAY, true);
  h.debug.setFishBay(FISH_BAY);

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  captureStill(h, "read-back");

  const s = h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = <T>(
    pose: () => void,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): void => {
    pose();
    assertEqual(read(h.snapshot()), want, what);
  };

  // ---- The fields the far shore reports ---------------------------------

  assertLength(
    s.bays,
    BAY_COUNT,
    `snapshot().bays, one entry per bay of the far shore (BAY_COUNT ` +
      `${BAY_COUNT}, specs/strait.md)`,
  );
  for (const [index, filled] of s.bays.entries()) {
    assertEqual(typeof filled, "boolean", `snapshot().bays[${index}]`);
  }
  assertEqual(
    typeof s.fishBay,
    "number",
    `snapshot().fishBay after setFishBay(${FISH_BAY}), which is the bay index ` +
      `holding the bonus catch or null when none is out`,
  );

  // ---- What each pose reads back ----------------------------------------

  for (const filled of [true, false]) {
    readsBack(
      () => h.debug.setBay(BAY, filled),
      (s) => s.bays[BAY],
      filled,
      `snapshot().bays[${BAY}] after setBay(${BAY}, ${filled})`,
    );
  }
  readsBack(
    () => h.debug.setFishBay(FISH_BAY),
    (s) => s.fishBay,
    FISH_BAY,
    `snapshot().fishBay after setFishBay(${FISH_BAY})`,
  );

  // `clearFish` is the other half of the bonus catch's own reading: a build that
  // reports the bay it was put in and never reports its absence hides a catch
  // that has left the strait (specs/instrumentation.md).
  h.debug.clearFish();
  assertEqual(
    h.snapshot().fishBay,
    null,
    "snapshot().fishBay after clearFish(), which takes the bonus catch off the " +
      "strait and leaves the bays as they are",
  );
});
