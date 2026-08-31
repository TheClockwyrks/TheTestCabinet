// Floe — audio/cue-hop: an accepted hop plays the hop cue exactly once, and a
// refused hop plays it none.
//
// WHAT AN ENGINE MAKES READABLE, AND WHY EVERY CHECK HERE READS IT. The game asks
// the engine's cue bus for a cue BY NAME and the bus announces the play on the
// frame it happened, carrying that name (`engine/audio.md`). So a check here
// reads the NAME and COUNTS the plays, rather than listening for a sound and
// inferring which event it belonged to: "the hop cue played once on the tick the
// hop was taken" is a fact the runtime states. Every file in this directory rests
// on that, and none of them asserts anything about how a cue SOUNDS —
// `specs/ui.md` asks that the ten be told apart by ear and leaves the synthesis
// to the build, so that is the reviewer's to judge, not a check's.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `hop` cue plays when "an
// accepted hop is taken. A refused hop plays nothing", and each cue is played "on
// the tick its event happens, once per tick however many times the event was
// raised within it". Both halves are read from ONE posed strait, because together
// they are what separates a build that cues the INPUT from one that cues the
// MOVEMENT. The near shore (`ROW_NEAR`, row `19`) is the bottom row of the grid,
// so a hop DOWN from it targets row `20` and is refused for being outside the
// grid (`specs/hopping.md`); a hop UP from it lands on row `18`, which
// `specs/strait.md` makes ice the critter may stand on anywhere, and this strait
// carries no vehicle to refuse it.
//
// AND THE CUE IS HELD TO THE HOP RATHER THAN TO THE KEY. Each direction is
// RELEASED after the tick that delivers it, and the settle window that follows is
// several times the `HOP_COOLDOWN` a HELD direction auto-repeats at
// (`specs/hopping.md`), so a build that played the cue on every tick a key was
// down, or on every tick at all, sounds inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { CUES, HOP_COOLDOWN, ROW_NEAR, START_COL } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  keyFor,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/**
 * A quarter second of posed strait recorded before anything is pressed.
 *
 * Long enough that a build playing a cue on a timer rather than on an event is
 * heard: it is two of the `HOP_COOLDOWN` (`0.12` s) `specs/hopping.md` fixes as
 * the game's shortest repeating interval.
 */
const QUIET_TICKS = ticksFor(0.25);

/**
 * Half a second driven after each key is released.
 *
 * Four of `HOP_COOLDOWN`, so a build that repeated a RELEASED direction — which
 * `specs/hopping.md` forbids, "a press released before the cooldown reaches `0`
 * produces exactly one hop" — would have hopped, and sounded, several times over
 * inside it.
 */
const SETTLE_TICKS = ticksFor(HOP_COOLDOWN * 4);

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

it("plays the hop cue once on the accepted hop and not at all on the refused one", async () => {
  // An empty strait with the critter where a fresh crossing puts it: the near
  // shore at `START_COL`. Nothing else is on it, so nothing else can raise an
  // event that plays a cue.
  startCrossing(h);

  const played = watchCues(h);
  const measured = await captureReplay(h, "hop", async () => {
    const beforeQuiet = played.length;
    await h.advance(QUIET_TICKS);
    const quiet = sounded(played, beforeQuiet, CUES.hop);

    // DOWN from the bottom row of the grid: refused (specs/hopping.md).
    const beforeRefused = played.length;
    await h.tap(keyFor("down"));
    await h.advance(SETTLE_TICKS);
    const refused = sounded(played, beforeRefused, CUES.hop);
    const stood = critterTile(h.snapshot());

    // UP onto the ice band, which this strait leaves clear: accepted.
    const beforeHop = played.length;
    const beforeFrame = h.engine.frame().count;
    await h.tap(keyFor("up"));
    const onHop = played
      .slice(beforeHop)
      .filter((entry) => entry.cue === CUES.hop);
    const landed = critterTile(h.snapshot());

    const beforeSettle = played.length;
    await h.advance(SETTLE_TICKS);
    const afterHop = sounded(played, beforeSettle, CUES.hop);

    return { quiet, refused, stood, beforeFrame, onHop, landed, afterHop };
  });

  assertEqual(measured.quiet, 0, "no hop cue on the untouched strait");

  // The refused hop really was refused: it left the critter where it stood
  // (specs/hopping.md, "A refused hop leaves everything as it was").
  assertDeepEqual(
    measured.stood,
    { col: START_COL, row: ROW_NEAR },
    "the refused hop left the critter on the near shore",
  );
  assertEqual(measured.refused, 0, "no hop cue on the refused hop");

  // The accepted hop really moved the critter one tile up.
  assertDeepEqual(
    measured.landed,
    { col: START_COL, row: ROW_NEAR - 1 },
    "the accepted hop took the critter one row up",
  );

  // Exactly once, on the tick the hop was taken (specs/ui.md).
  assertLength(measured.onHop, 1, "hop cues played on the accepted hop");
  assertEqual(
    measured.onHop[0]?.frame,
    measured.beforeFrame + 1,
    "the hop cue played on the tick the hop was taken",
  );
  assertEqual(
    measured.afterHop,
    0,
    "no further hop cue once the direction is released",
  );
});
