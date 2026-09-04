// Floe — audio/cue-splash: the tick the critter's footing is open water plays the
// splash cue.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `splash` cue plays when "the
// critter falls into open water". `specs/water.md` fixes when that is — "the
// critter falls in on any tick on which its footing is `water`" — and
// `specs/strait.md` fixes the footing: a row of the water band (`WATER_TOP` to
// `WATER_BOTTOM`, rows `2`–`9`) with no floe covering the critter's centre. This
// strait carries no floe at all, so the posed tile is open water by that rule
// alone, and the snapshot's own `footing` is read back before the tick to prove
// it rather than assumed.
//
// THE SOLID PART OF THE POSE IS THE CONTROL. The critter is first stood on the
// near shore, which `specs/strait.md` makes solid, and a quarter second is driven
// there: a build that plays the splash on a timer, or on every tick, is heard
// before the fall rather than credited for it. Only then is the critter moved
// onto the water, and the fall is driven ONE TICK, so the cue is attributed to
// exactly the tick the event happens on, which is what `specs/ui.md` requires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES, DEATH_PAUSE, START_COL, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
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
 * Half a second driven after the fall.
 *
 * Shorter than `DEATH_PAUSE` (`0.9` s), so the hold `specs/progression.md` fixes
 * is still running at the end of it and nothing a fresh crossing does can land
 * inside the window — a second splash counted there would belong to a second
 * fall rather than to a build repeating this one.
 */
const AFTER_TICKS = ticksFor(DEATH_PAUSE / 2);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the splash cue on the tick the critter's footing is open water", async () => {
  // An empty strait: no floe anywhere, so every tile of the water band is open
  // water, and no vehicle, bear or timer can take the life instead.
  startCrossing(h);

  const played = watchCues(h);
  const measured = await captureReplay(h, "splash", async () => {
    const beforeQuiet = played.length;
    await h.advance(QUIET_TICKS);
    const quiet = sounded(played, beforeQuiet, CUES.splash);
    const onIce = h.snapshot();

    h.debug.setCritterTile(START_COL, FALL_ROW);
    const posed = h.snapshot();

    const beforeFall = played.length;
    const beforeFrame = h.engine.frame().count;
    await h.advance(1);
    const onFall = played
      .slice(beforeFall)
      .filter((entry) => entry.cue === CUES.splash);
    const fell = h.snapshot();

    const beforeAfter = played.length;
    await h.advance(AFTER_TICKS);
    const after = sounded(played, beforeAfter, CUES.splash);

    return { quiet, onIce, posed, beforeFrame, onFall, fell, after };
  });

  assertEqual(
    measured.onIce.critter.footing,
    "solid",
    "the near shore is solid footing",
  );
  assertEqual(
    measured.quiet,
    0,
    "no splash cue while the critter stands on it",
  );

  // The posed tile really is open water, by the footing rule specs/strait.md
  // fixes rather than by anything this check decided.
  assertEqual(
    measured.posed.critter.footing,
    "water",
    "the posed tile is open water",
  );

  // The fall really happened, on that tick (specs/water.md,
  // specs/progression.md).
  assertEqual(measured.fell.lives, START_LIVES - 1, "the fall cost a life");
  assertEqual(measured.fell.phase, "dying", "the fall opened the death hold");

  assertLength(measured.onFall, 1, "splash cues played on the falling tick");
  assertEqual(
    measured.onFall[0]?.frame,
    measured.beforeFrame + 1,
    "the splash cue played on the tick the critter fell in",
  );
  assertEqual(
    measured.after,
    0,
    "no further splash cue over the death hold that follows",
  );
});
