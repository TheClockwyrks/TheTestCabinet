// screens/howto-shows-the-controls — the how-to screen names every key the game
// is played with.
//
// `specs/ui.md` makes the `howto` screen "How to play, written in a player's
// words", lists what it covers, and ends that list with "the controls". It then
// fixes exactly what naming the controls means: "The controls it names include
// every key `specs/controls.md` binds, written as the standalone words
// `ARROWS`, `WASD`, `SPACE`, `ENTER`, `ESC`, `P`, and `M`" — with `F` among them
// under `warhead`, where `specs/controls.md` binds the torpedo to `KeyF`.
//
// THE LIST IS DERIVED FROM `BINDINGS`, NOT TYPED OUT. `src/constants.ts`'s
// `BINDINGS` is the case's own table of the keys `specs/controls.md` binds, so
// the words required here are read off it through the mapping below — which is
// the specification's own list, key for word. That is what makes the check the
// same check under both variants: `warhead` binds `KeyF` and so requires `F`,
// and `base` binds no such key and so does not, without a branch on the variant
// anywhere in this file. A key the table binds that the mapping does not cover
// is asserted to be none, so a later revision that adds a binding fails here
// rather than quietly dropping a word from the requirement.
//
// STANDALONE WORDS, WHICH IS WHAT THE SPECIFICATION ASKS FOR. Each word must
// appear with a non-alphanumeric on either side of it or at an end of a run, so
// a screen that never names `P` still fails on a page full of the letter, and
// `M` is not satisfied by `MUTE`. Case is ignored, because `specs/ui.md` leaves
// "the type" of each screen to the build.
//
// THE SCREEN IS POSED DIRECTLY. `setScreen("howto")` is the operation
// `specs/instrumentation.md` provides for exactly this, and it "spawns nothing
// and clears nothing" — so the reading is of the how-to screen alone. Reaching
// it through the title menu instead would fold `screens/howto-reachable`'s
// requirement into this one.
//
// WHAT THIS DOES NOT DECIDE. That the screen is reachable
// (`screens/howto-reachable`), that it returns (`screens/howto-returns`), which
// key does what (`controls/*`), and everything else `specs/ui.md` has the screen
// cover, which is prose a reviewer rates rather than a figure a check reads.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertLength, assertMatches } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  resetTo,
  type Harness,
} from "../harness";
import { drawnRuns } from "./reading";

/**
 * The word `specs/ui.md` requires for each key `specs/controls.md` binds.
 *
 * The specification's own list, read the other way round: it names the words
 * `ARROWS`, `WASD`, `SPACE`, `ENTER`, `ESC`, `P`, `M` and — under `warhead` —
 * `F`, and this says which key each of them stands for. The four arrows share
 * one word and the four `WASD` keys share another, exactly as the specification
 * writes them.
 */
const WORD_FOR_KEY: Readonly<Record<string, string>> = {
  ArrowUp: "ARROWS",
  ArrowDown: "ARROWS",
  ArrowLeft: "ARROWS",
  ArrowRight: "ARROWS",
  KeyW: "WASD",
  KeyA: "WASD",
  KeyS: "WASD",
  KeyD: "WASD",
  Space: "SPACE",
  Enter: "ENTER",
  Escape: "ESC",
  KeyP: "P",
  KeyM: "M",
  KeyF: "F",
};

/** Every key the case's own `BINDINGS` table binds, once each. */
const BOUND_KEYS: readonly string[] = [
  ...new Set(Object.values(BINDINGS).flatMap((binding) => binding.keys)),
];

/** Any bound key the mapping above has no word for: there must be none. */
const UNMAPPED_KEYS = BOUND_KEYS.filter((key) => !(key in WORD_FOR_KEY));

/** The words the screen must name, in the order `BINDINGS` binds their keys. */
const REQUIRED_WORDS: readonly string[] = [
  ...new Set(
    BOUND_KEYS.filter((key) => key in WORD_FOR_KEY).map(
      (key) => WORD_FOR_KEY[key],
    ),
  ),
];

/** `word` standing on its own, rather than inside a longer run of characters. */
function standalone(word: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${word.toLowerCase()}([^a-z0-9]|$)`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names every key BINDINGS binds, as a standalone word, on the howto screen", async () => {
  // The how-to screen, posed directly and drawn once.
  resetTo(h);
  h.debug.setScreen("howto");
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "howto");

  const drawn = drawnRuns(h);

  assertLength(
    UNMAPPED_KEYS,
    0,
    "keys in src/constants.ts's BINDINGS that this check has no required " +
      "word for — specs/ui.md requires the how-to screen to name every key " +
      `specs/controls.md binds, so a binding with no word here would go ` +
      `ungraded: ${JSON.stringify(UNMAPPED_KEYS)}`,
  );

  for (const word of REQUIRED_WORDS) {
    assertMatches(
      drawn,
      standalone(word),
      `the standalone word ${JSON.stringify(word)} among the runs of text the ` +
        "howto screen drew — its controls name every key specs/controls.md " +
        `binds, written as the standalone words ` +
        `${REQUIRED_WORDS.join(", ")} (specs/ui.md)`,
    );
  }
});
