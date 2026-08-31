// waves/wave-one-spawns-four — the opening wave of a game puts up four Large
// rocks.
//
// THE RULE. `specs/progression.md`, "Waves": "Wave `N` spawns
// `WAVE_BASE_ROCKS + N` (`3 + N`) Large rocks, so wave 1 puts up four and wave 2
// puts up five." `reset` leaves the wave at `0` and a new game begins at wave `1`
// (`specs/instrumentation.md`, `specs/progression.md`), so the wave that follows a
// cleared wave `0` is the game's own opening one.
//
// WHAT IS MEASURED. The rock roster on the first tick a game opened from the
// title holds one, against `WAVE_BASE_ROCKS + 1` (`4`) — and every one of them a
// Large. The base of the rule, read where a build cannot have got it right by
// arithmetic on a posed number: `wave-n-spawns-three-plus-n` reads the slope with
// the wave posed at six, and a build that spawns a constant four every wave
// passes here and fails there, while a build that spawns `N` rather than `3 + N`
// fails here and passes nothing.
//
// THE ROUTE IS THE GAME'S OWN. `startRun` is `reset` for the title screen and a
// seeded generator, then `confirm` on the title's highlighted first entry, `PLAY`
// — the path `specs/ui.md` gives a player. No pose on the debug surface starts a
// run, and there is not meant to be one: this item is about the wave a real game
// opens with.
//
// EITHER OPENING IS ACCEPTABLE, AND THE CHECK ACCOMMODATES BOTH.
// `specs/progression.md`: "Either opening is acceptable for wave 1: put the rocks
// up at once when the game begins, or run the `WAVE 1` banner first and spawn as
// it ends." So the check waits for the rocks rather than reading them on any
// particular tick, and the window covers a full `WAVE_BANNER_TIME` with room on
// top. What it does NOT accommodate is a build that puts up a different number of
// them.
//
// THREE SEEDS. The positions of a wave's rocks are drawn (`specs/simulation.md`,
// "Seeded randomness"), and the placement rules `specs/progression.md` states are
// constraints a build satisfies by rejecting and redrawing. A build whose
// rejection loop gives up after a fixed number of tries and spawns fewer rocks
// than it owes fails intermittently by construction, so the opening wave is
// opened three times from three seeds and every one of them has to hold four.
//
// WHAT THIS ITEM DOES NOT DECIDE. WHERE the four stand, which is
// `spawns-clear-of-the-ship`'s and `spawns-clear-of-the-star`'s, and how fast they
// drift, which is `speed-scales-per-wave`'s.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME, WAVE_BASE_ROCKS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
  type RockSnapshot,
} from "../harness";

/** The wave a new game opens on, and what `specs/progression.md` says it holds. */
const OPENING_WAVE = 1;
const OPENING_ROCKS = WAVE_BASE_ROCKS + OPENING_WAVE;

/**
 * The three seeds the opening is flown from.
 *
 * A wave's positions are drawn, and a build that satisfies the placement rules by
 * rejecting and redrawing can run out of tries on one draw and not on another.
 * One opening would grade that build by luck.
 */
const SEEDS: readonly number[] = [1, 2, 3];

/**
 * How long the opening wave is waited for.
 *
 * `WAVE_BANNER_TIME` (`1.5` s) and half a second, because a build is free to run
 * the `WAVE 1` banner before it spawns (`specs/progression.md`). A build that puts
 * the rocks up at once is answered on the first tick and never uses the window.
 */
const OPENING_WINDOW_TICKS = ticksFor(WAVE_BANNER_TIME + 0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a game with WAVE_BASE_ROCKS + 1 Large rocks", async () => {
  for (const seed of SEEDS) {
    await startRun(h, seed);

    const opened = h.snapshot();
    assertEqual(
      opened.screen,
      "playing",
      `seed ${String(seed)}: a game in play after confirming PLAY on the ` +
        `title, which is the route this item's opening wave arrives by ` +
        `(specs/ui.md); a build that does not start a game here is decided by ` +
        `screens/play-starts-a-game`,
    );

    const arrival = await h.until((s) => s.rocks.length > 0, {
      maxFrames: OPENING_WINDOW_TICKS,
      poll: 1,
    });
    const rocks: RockSnapshot[] = arrival.snapshot.rocks;
    // The opening wave as it arrived, kept before the assertions so a failing
    // build leaves the picture that shows why.
    captureStill(h, "wave");

    assertLength(
      rocks,
      OPENING_ROCKS,
      `seed ${String(seed)}: wave ${String(OPENING_WAVE)} putting up ` +
        `WAVE_BASE_ROCKS + ${String(OPENING_WAVE)} = ` +
        `${String(OPENING_ROCKS)} rocks — wave N spawns WAVE_BASE_ROCKS + N ` +
        `Large rocks (specs/progression.md); read on the first tick the field ` +
        `held a rock, within ${String(WAVE_BANNER_TIME + 0.5)} s of the game ` +
        `opening, so either opening the specification allows is accommodated`,
    );

    const wrongSize = rocks.filter((rock) => rock.size !== "large");
    assertLength(
      wrongSize,
      0,
      `seed ${String(seed)}: every rock of the opening wave a Large — a wave ` +
        `spawns Large rocks (specs/progression.md); found ` +
        `${wrongSize.map((rock) => rock.size).join(", ")}`,
    );
  }
});
