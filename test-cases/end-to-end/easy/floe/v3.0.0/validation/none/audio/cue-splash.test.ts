// Floe — audio/cue-splash: the tick the critter's footing is open water sounds.
//
// Cue NAMES are not observable outside an engineless build, and neither is
// "exactly once"; see audio/cue-hop for the doctrine every check here rests on.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `splash` cue plays when "the
// critter falls into open water". `specs/water.md` fixes when that is — "the
// critter falls in on any tick on which its footing is `water`" — and
// `specs/strait.md` fixes the footing: a row of the water band (`WATER_TOP` to
// `WATER_BOTTOM`, rows `2`–`9`) with no floe covering the critter's centre. This
// strait carries no floe at all, so the posed tile is open water by that rule
// alone, and the snapshot's own `footing` is read back before the tick to prove
// it.
//
// THE SOLID PART OF THE POSE IS THE CONTROL. The critter is first stood on the
// near shore, which `specs/strait.md` makes solid ice, and a quarter second is
// driven there: a build that blips on a timer, or on every tick, is heard before
// the fall rather than credited for it. Only then is the critter moved onto the
// water, and the fall is driven ONE TICK, so the sound is attributed to exactly
// the tick the event happens on, which is what `specs/ui.md` requires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { DEATH_PAUSE, START_COL, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * The row the critter is dropped onto: a row of the water band.
 *
 * Any of rows `2`–`9` decides the same rule (`specs/strait.md`); the middle of
 * the band is taken so the tile is nowhere near either solid strip.
 */
const FALL_ROW = 5;

/** A quarter second on solid ice before the fall, proving the strait is quiet. */
const QUIET_TICKS = ticksFor(0.25);

/**
 * Half a second recorded after the fall, so the replay shows it.
 *
 * Shorter than `DEATH_PAUSE` (`0.9` s), so the hold `specs/progression.md` fixes
 * is still running at the end of it and nothing a fresh crossing does can land
 * inside the window.
 */
const AFTER_TICKS = ticksFor(DEATH_PAUSE / 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the critter's footing is open water", async () => {
  // An empty strait: no floe anywhere, so every tile of the water band is open
  // water, and no vehicle, bear or timer can take the life instead.
  await startCrossing(h);
  await h.armAudio();

  const played = watchCues(h);
  const measured = await captureReplay(h, "splash", async () => {
    const beforeQuiet = played.length;
    await h.advance(QUIET_TICKS);
    const quiet = played.length - beforeQuiet;
    const onIce = await h.snapshot();

    await h.debug.setCritterTile(START_COL, FALL_ROW);
    const posed = await h.snapshot();

    const beforeFall = played.length;
    await h.advance(1);
    const onFall = played.length - beforeFall;
    const fell = await h.snapshot();

    const beforeAfter = played.length;
    await h.advance(AFTER_TICKS);
    const after = played.length - beforeAfter;

    return { quiet, onIce, posed, onFall, fell, after };
  });

  assertEqual(
    measured.onIce.critter.footing,
    "solid",
    "the near shore is solid",
  );
  assertEqual(measured.quiet, 0, "no sound while the critter stands on ice");

  // The posed tile really is open water, by the footing rule specs/strait.md
  // fixes rather than by anything this check decided.
  assertEqual(
    measured.posed.critter.footing,
    "water",
    "the posed tile is open water",
  );

  // The fall really happened, on that tick (specs/progression.md).
  assertEqual(measured.fell.lives, START_LIVES - 1, "the fall cost a life");
  assertEqual(measured.fell.phase, "dying", "the fall opened the death hold");

  assertGreaterThan(
    measured.onFall,
    0,
    "a sound on the tick the critter falls in",
  );
  assertEqual(
    measured.after,
    0,
    "no further sound over the death hold that follows",
  );
});
