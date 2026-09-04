// screens/howto-names-the-torpedo-key — the how-to screen names the key this variant
// binds the torpedo to. `warhead` only.
//
// THE RULE. `specs/controls.md` binds `b` to `KeyF` under this variant — the torpedo
// key — and to `Space` under `base`, where the gun's own key already covers the word
// `SPACE`. `specs/ui.md` requires the how-to screen's controls to name "every key
// `specs/controls.md` binds, written as the standalone words ... and `F`". The word
// is read off `../constants`'s transcription of the binding table rather than written
// out, so it is the specification's word and a revision of the table moves it.
//
// WHY IT IS AN ITEM OF ITS OWN. `screens/howto-shows-the-controls` is on BOTH
// checklists, and the only thing it could branch on to decide whether to demand this
// word is what the build implemented — whether it reports a torpedo roster at all. A
// requirement decided that way can be shed by implementing less: a `warhead` build
// that never wrote the torpedo would be asked for one word fewer and pass, while one
// that wrote the whole torpedo and forgot to name its key would fail, so the grade
// would reward the less complete build. This item is named by the warhead checklist
// alone, so it asks unconditionally.
//
// STANDALONE WORDS, WHICH IS WHAT THE SPECIFICATION ASKS FOR. The word must appear
// with a non-alphanumeric on either side of it or at an end of a run, so a screen
// that never names `F` still fails on a page full of the letter. Case is ignored,
// because `specs/ui.md` leaves "the type" of each screen to the build.
//
// THE SCREEN IS POSED DIRECTLY, for the reason its sibling gives: reaching it
// through the title menu would fold `screens/howto-reachable`'s requirement into
// this one.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, VARIANT_ACTION } from "../constants";
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
 * The word `specs/ui.md` requires for each key the variant's own row binds.
 *
 * The same mapping `screens/howto-shows-the-controls` reads the common rows
 * through, narrowed to the one row that is this item's: `specs/ui.md` names `F`
 * among the standalone words, and this says which key it stands for.
 */
const WORD_FOR_KEY: Readonly<Record<string, string>> = {
  KeyF: "F",
};

/** Any key the variant's row binds that the mapping has no word for: there must be none. */
function unmappedKeys(keys: readonly string[]): readonly string[] {
  return keys.filter((key) => !(key in WORD_FOR_KEY));
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

it("names the torpedo key as a standalone word on the howto screen", async () => {
  resetTo(h);
  h.debug.setScreen("howto");
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "howto");

  const drawn = drawnRuns(h);
  const keys = BINDINGS[VARIANT_ACTION].keys;
  const unmapped = unmappedKeys(keys);

  assertLength(
    unmapped,
    0,
    "keys in specs/controls.md's variant binding row that this check has no " +
      "required word for — specs/ui.md requires the how-to screen to name " +
      "every key specs/controls.md binds, so a binding with no word here " +
      `would go ungraded: ${JSON.stringify(unmapped)}`,
  );

  for (const key of keys) {
    const word = WORD_FOR_KEY[key];
    assertMatches(
      drawn,
      standalone(word),
      `the standalone word ${JSON.stringify(word)} among the runs of text the ` +
        "howto screen drew — the torpedo key this variant binds, named beside " +
        "the keys every variant binds (specs/ui.md, specs/controls.md)",
    );
  }
});
