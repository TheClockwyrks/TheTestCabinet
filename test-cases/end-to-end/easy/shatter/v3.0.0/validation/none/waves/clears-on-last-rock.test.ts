// waves/clears-on-last-rock — destroying the last rock on the field turns the wave
// over.
//
// `specs/progression.md`, Clearing a wave: "A wave clears on the tick in which the
// last rock on the field is destroyed." And, The banner: "On the tick a wave
// clears, the wave number advances by one and a `WAVE N` banner appears."
//
// THIS ITEM READS THE TRANSITION AND NOTHING ELSE. The number the banner announces
// is `wave-number-increments`'s point and the negative direction — that an emptied
// field is not a cleared one — is `an-empty-field-does-not-clear-by-itself`'s, so a
// build with one defect in the wave loop misses one point per requirement rather
// than three per defect. What is read here is a pair of ticks: the field with one
// rock standing and no banner, and the field one kill later with no rock and a
// banner. A transition needs both readings; a check that took only the second could
// not tell a build that clears on the last rock from one that cleared three rocks
// earlier.
//
// THE FIELD IS SHOT DOWN, NOT CLEARED. This is the item the fold-in fix was
// written for. `specs/instrumentation.md` says of `clearRocks` that "it destroys
// nothing and scores nothing, so a field it emptied has had no rock destroyed on
// that tick" — so a check that reached this banner by calling it would be grading
// the debug operation rather than the game, and would fail every build that raises
// its next wave from the destruction event rather than from polling the roster's
// length. Every rock here dies to a round placed on its doorstep through
// `addBullet` and resolved by the build's own collision and split code.
//
// AND THE FIELD REALLY IS SHOT DOWN, from two Large rocks rather than from one
// Small. `specs/rocks.md` has a Large leave two Mediums and a Medium leave two
// Smalls, so the number of rocks on the field falls only when a Small is
// destroyed: the fourteen rounds this takes under `base` walk the roster up before
// they walk it down, and a build that clears the wave on any kill but the last one
// is caught by the BEFORE reading rather than passing on the after.
//
// ONE TICK OF LATITUDE, AND ONLY ONE. `specs/simulation.md` puts collision
// resolution last in a tick, so a build that notices the destroyed rock inside that
// step raises the banner on the same tick and one that notices it at the top of the
// next step raises it one tick later. That is the whole latitude the stated tick
// order leaves. It is not slack for a build that announces late, which one extra
// tick out of a hundred and eighty cannot hide.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { WAVE_BANNER_TIME } from "../constants";
import {
  captureReplay,
  createHarness,
  destroyRock,
  shootFieldDown,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { CLEAR_GRACE_TICKS, poseLiveWave } from "./scenario";

/** The wave the run is posed at. Nothing here reads the number; it only needs one. */
const POSED_WAVE = 3;

/** How many Large rocks the field is shot down from. */
const STANDING_LARGE = 2;

/** How much of the banner the replay keeps after the kill: a third of it. */
const WITNESS_TICKS = ticksFor(WAVE_BANNER_TIME / 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("raises the banner on the tick the last rock is destroyed, and not before", async () => {
  await poseLiveWave(h, { wave: POSED_WAVE, large: STANDING_LARGE });

  // Down to one rock, and by shooting: the walk from two Large rocks to one Small
  // destroys fourteen rocks without the field ever emptying.
  await shootFieldDown(h, { leave: 1 });
  const before: ShatterSnapshot = await h.snapshot();

  assertLength(
    before.rocks,
    1,
    "rocks standing after the field was shot down to its last Small, which " +
      "specs/rocks.md makes the only kill that lowers the count",
  );
  assertEqual(
    before.rocks[0].size,
    "small",
    "the size of the last rock standing, which specs/rocks.md leaves nothing " +
      "behind when it is destroyed",
  );
  assertLessThanOrEqual(
    before.waveBanner,
    0,
    `the seconds left on the WAVE N banner with one rock still on the field: ` +
      `specs/progression.md clears a wave on the tick the LAST rock is ` +
      `destroyed, so nothing has cleared yet (the game reports wave ` +
      `${before.wave})`,
  );

  const cleared = await captureReplay(h, "clear", async () => {
    const kill = await destroyRock(h, before.rocks[0].id);
    // The one tick of latitude the stated tick order leaves, taken here rather
    // than in a helper because this is the item that owns the requirement: what
    // it reads has to be what it grades.
    const raised =
      kill.result.snapshot.waveBanner > 0
        ? kill.result.snapshot
        : (
            await h.until((snapshot) => snapshot.waveBanner > 0, {
              maxTicks: CLEAR_GRACE_TICKS,
              poll: 1,
            })
          ).snapshot;
    // The banner going up, and a moment of it running, for a reviewer to watch.
    await h.advance(WITNESS_TICKS);
    return { kill: kill.result.snapshot, raised };
  });

  assertLength(
    cleared.kill.rocks,
    0,
    "rocks left on the field on the tick the last Small was destroyed",
  );
  assertGreaterThan(
    cleared.raised.waveBanner,
    0,
    `the seconds left on the WAVE N banner within ${CLEAR_GRACE_TICKS} tick of ` +
      `the last rock being destroyed, which specs/progression.md raises on the ` +
      `tick the wave clears`,
  );
});
