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
// THE LIST IS DERIVED FROM `BINDINGS`, NOT TYPED OUT. `../constants`'s
// `BINDINGS` is this validator's transcription of the key table
// `specs/controls.md` fixes — the specification's table, not the build's own copy
// of it — so the words required here are read off it through the mapping below,
// which is the specification's own list, key for word.
//
// THE ONE VARIANT-DEPENDENT ROW IS READ, NOT ASSUMED. `specs/controls.md` binds
// `b` to `KeyF` under `warhead`, where it launches the torpedo, and to `Space`
// under `base`, where the gun's own key already covers the word `SPACE`. So that
// row is taken only from a build that reports a torpedo roster at all
// (`carriesTorpedoes`, `specs/instrumentation.md`): `warhead` is graded on `F`
// and `base` is not. The probe decides nothing about the SCENARIO — the screen is
// the same either way — only how long the specification's list is for this build.
// A key the table binds that the mapping does not cover is asserted to be none,
// so a later revision that adds a binding fails here rather than quietly dropping
// a word from the requirement.
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
import { BINDINGS, VARIANT_ACTION, type ActionName } from "../constants";
import { assertLength, assertMatches } from "../assert";
import {
  captureStill,
  carriesTorpedoes,
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

/**
 * Every key `specs/controls.md` binds this build, once each.
 *
 * The whole transcribed table but for its one variant-dependent row, which is
 * included only where the build carries torpedoes.
 */
function boundKeys(withTorpedo: boolean): readonly string[] {
  const actions = (Object.keys(BINDINGS) as ActionName[]).filter(
    (action) => withTorpedo || action !== VARIANT_ACTION,
  );
  return [...new Set(actions.flatMap((action) => BINDINGS[action].keys))];
}

/** Any bound key the mapping above has no word for: there must be none. */
function unmappedKeys(keys: readonly string[]): readonly string[] {
  return keys.filter((key) => !(key in WORD_FOR_KEY));
}

/** The words the screen must name, in the order `BINDINGS` binds their keys. */
function requiredWords(keys: readonly string[]): readonly string[] {
  return [
    ...new Set(
      keys.filter((key) => key in WORD_FOR_KEY).map((key) => WORD_FOR_KEY[key]),
    ),
  ];
}

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

  const keys = boundKeys(carriesTorpedoes(h));
  const unmapped = unmappedKeys(keys);
  const required = requiredWords(keys);

  assertLength(
    unmapped,
    0,
    "keys in specs/controls.md's BINDINGS that this check has no required " +
      "word for — specs/ui.md requires the how-to screen to name every key " +
      `specs/controls.md binds, so a binding with no word here would go ` +
      `ungraded: ${JSON.stringify(unmapped)}`,
  );

  for (const word of required) {
    assertMatches(
      drawn,
      standalone(word),
      `the standalone word ${JSON.stringify(word)} among the runs of text the ` +
        "howto screen drew — its controls name every key specs/controls.md " +
        `binds, written as the standalone words ` +
        `${required.join(", ")} (specs/ui.md)`,
    );
  }
});
