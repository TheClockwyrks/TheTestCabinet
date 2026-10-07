// screens/howto-names-the-torpedo-key — the how-to screen names the key this variant
// binds the torpedo to. `warhead` only.
//
// THE RULE. `specs/controls.md` binds `b` to `KeyF` under this variant — the torpedo
// key — and to `Space` under `base`, where it is a second way to fire a gun `a`
// already fires. `specs/ui.md` requires the how-to screen to name "every key
// `specs/controls.md` binds, written as the standalone words ... and `F`". The word
// is derived from `../constants`'s transcription of the binding table through the
// same mapping `screens/howto-shows-the-controls` uses, so it is the
// specification's word rather than a second hand-kept copy of it.
//
// WHY IT IS AN ITEM OF ITS OWN. That sibling script is on BOTH checklists, and the
// only thing it could branch on to decide whether to demand this word is what the
// build implemented — whether it reports a torpedo roster at all. A requirement
// decided that way can be shed by implementing less: a `warhead` build that never
// wrote the torpedo would be asked for one word fewer and pass, while one that wrote
// the whole torpedo and forgot to name its key would fail, so the grade would reward
// the less complete build. This item is named by the warhead checklist alone, so it
// asks unconditionally.
//
// STANDALONE IS THE READING THE SPECIFICATION ASKS FOR. A word counts only where no
// letter or digit sits either side of it, so the `F` of `FIRES` does not name the
// key — a screen has to write the key. Case and layout are the build's.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO, for the reason its sibling gives: reaching
// it through the title menu would fold `screens/howto-reachable`'s requirement into
// this one's grade.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnCopy, textRuns, variantKeyWords, wordPattern } from "./menu";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names the torpedo key on the how-to screen, as a standalone word", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");

  h.clearCalls();
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the controls were read from",
  );

  const copy = drawnCopy(textRuns(h, h.calls));
  for (const word of variantKeyWords()) {
    assertMatches(
      copy,
      wordPattern(word),
      `the torpedo key ${JSON.stringify(word)} named as a standalone word on ` +
        `the how-to screen, beside the keys every variant binds (specs/ui.md, ` +
        `specs/controls.md)`,
    );
  }
});
