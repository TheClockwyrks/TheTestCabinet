// Facet — board/opening-falls-in: the board a round opens on is dealt in from
// above, so every gem of it reports a `fell` of at least `row + 1`.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/rules.md closes "The opening board" with
// it: "The whole board is dealt in from above, so a gem dealt into row `r`
// carries a `fell` of at least `r + 1`, exactly as a refilled gem does under R9."
// It is one sentence and it does one thing — it says a round OPENS with the board
// arriving rather than with the board simply being there. A build that deals its
// sixty-four gems in place has a level that begins with a picture and a build
// that deals them from above has a level that begins with a movement, and the
// figure each gem carries is what the renderer reads to draw the difference.
//
// WHY THE FLOOR AND NOTHING ABOVE IT. The same paragraph hands the rest to the
// build: "Which figure at or above that each dealt gem carries is the build's."
// That freedom is not an oversight — it is what decides the SHAPE a column fills
// in. A build that drops the whole board from one height above row `0` gives the
// gem at row `7` a fall of `8` and the gem at row `0` a fall of `1`, so the
// column arrives as a column; a build that staggers its deal gives every gem a
// longer fall and the board arrives in a wave. Both are conformant, and a check
// that asserted a figure would fail one of them for a choice the specification
// granted. So `board.ts` expresses a dealt gem's fall as `{ atLeast: row + 1 }`
// and `assertFell` reads it as the bound it is.
//
// WHERE THE READING IS TAKEN. On the board the deal left, with no frame advanced.
// `loadBoard` and `setGem` both give a gem a `fell` of `0`, and a step's own R9
// writes the figure again, so a reading taken after the game had run would be
// about whatever happened since rather than about what the deal wrote.
//
// WHY SEVERAL SEEDS. Each seed is a different draw off the build's own random
// source, and the property has to hold of every board it deals rather than of a
// lucky one. specs/instrumentation.md makes a round from a known deal `reset`
// carrying a seed followed by a `dealBoard`, which is what the harness's
// `startRound` runs and what the sweep below does twelve times.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { assertFell } from "../board";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureReplay,
  createHarness,
  startRound,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * The seeds a round is dealt from.
 *
 * Twelve arbitrary positive numbers, each a different draw off the build's own
 * seeded source. Nothing is asserted about any particular one.
 */
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 7777, 99991] as const;

/**
 * Frames recorded after the first deal, purely so the replay holds the arrival.
 *
 * Half a second of game time at the suite's 64 Hz clock, which is longer than
 * the deepest fall a dealt board can be drawn falling: a gem coming in from above
 * row `0` into row `7` travels `8` rows, and `8 * FALL_SECONDS_PER_ROW` is
 * `0.4` s. Nothing on the board moves over those frames — a posed or dealt board
 * rests until a swap is accepted on it — so they change no reading, and every
 * assertion below is made against the snapshot taken before them.
 */
const REPLAY_FRAMES = 32;

let h: Harness;

/** Seed the game's random source and open a fresh round on it. */
async function deal(seed: number): Promise<FacetSnapshot> {
  await h.debug.reset({ seed });
  return startRound(h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals every gem in from above its own row, from every seed", async () => {
  for (const seed of SEEDS) {
    // The evidence is the first deal's worth, and the reading it is taken from
    // is the one the deal returned, before the recorded frames ran.
    const opened =
      seed === SEEDS[0]
        ? await captureReplay(h, "deal", async () => {
            const reading = await deal(seed);
            await h.advance(REPLAY_FRAMES);
            return reading;
          })
        : await deal(seed);

    // Every cell has to be reported before "every gem fell" means anything: a
    // board of forty cells would satisfy the loop below and still be no opening
    // board.
    assertEqual(opened.screen, "playing", `screen dealt from seed ${seed}`);
    assertLength(
      opened.board.cells,
      GRID_COLS * GRID_ROWS,
      `cells dealt from seed ${seed}`,
    );

    for (const cell of opened.board.cells) {
      // The floor its own row gives it, and no ceiling. A gem in row `0` came
      // from above row `0`, so it traveled at least one row; a gem in row `7`
      // traveled at least eight.
      assertFell(
        cell.fell,
        { atLeast: cell.row + 1 },
        `the fell of (${cell.col},${cell.row}) dealt from seed ${seed}`,
      );
    }
  }
});
