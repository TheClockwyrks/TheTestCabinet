// Shatter — screens/howto-names-the-torpedo-key: the how-to screen names the key
// this variant binds the torpedo to. `warhead` only.
//
// THE RULE. `specs/controls.md` binds `KeyF` to the torpedo under this variant and
// binds nothing to it under `base`, and `specs/ui.md` says the `howto` screen's
// controls "include every key `specs/controls.md` binds, written as the standalone
// words ... and `F`". `HOWTO_WORD_TORPEDO` in `../constants` is that word.
//
// WHY IT IS AN ITEM OF ITS OWN RATHER THAN A LONGER LIST IN
// `screens/howto-shows-the-controls`. That script is on BOTH checklists, and the only
// thing it could branch on is what the build implemented — whether it reports a
// torpedo roster, or carries `addTorpedo`. A requirement decided that way is not a
// requirement: a `warhead` build that never wrote the torpedo would be asked for one
// word fewer and pass, while one that wrote the whole torpedo and forgot to name its
// key would fail, so the grade would reward the less complete build. This item is
// named by the `warhead` checklist alone, so it knows the variant from the checklist
// that loaded it and asks unconditionally.
//
// STANDALONE WORDS, NOT SUBSTRINGS. `drewWord` requires the word as its own token,
// which is the reading the specification's own phrasing asks for: a screen reading
// "the fastest route" contains an `f` and names no key.
//
// THE SCREEN IS POSED. `setScreen("howto")` is the direct route to the screen whose
// CONTENT this item grades; reaching it through the title menu is
// `screens/howto-reachable`'s requirement, and driving that route here would fail
// this item for that one's faults. The frame is presented rather than stepped, so
// nothing of the screen's own timing runs under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_WORD_TORPEDO } from "../constants";
import {
  captureStill,
  createHarness,
  drewWord,
  presentCalls,
  type Harness,
} from "../harness";
import { reachHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the torpedo key as a standalone word", async () => {
  await reachHowto(h);

  const calls = await presentCalls(h);
  await captureStill(h, "howto");

  assertEqual(
    drewWord(calls, HOWTO_WORD_TORPEDO),
    true,
    `the how-to screen names the torpedo key "${HOWTO_WORD_TORPEDO}" as a ` +
      "standalone word, beside the keys every variant binds (specs/ui.md, " +
      "specs/controls.md)",
  );
});
