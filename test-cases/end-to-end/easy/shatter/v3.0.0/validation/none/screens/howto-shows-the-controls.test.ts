// Shatter — screens/howto-shows-the-controls: the how-to screen names every key the
// game is played with.
//
// THE RULE. `specs/ui.md` says the `howto` screen covers "the controls", and fixes
// exactly how: "The controls it names include every key `specs/controls.md` binds,
// written as the standalone words `ARROWS`, `WASD`, `SPACE`, `ENTER`, `ESC`, `P` and
// `M`" — with `F` added under `warhead`, for the torpedo. Those words are
// `HOWTO_WORDS` and `HOWTO_WORD_TORPEDO` in `../constants`, and they are the whole of
// what this item reads: everything else the screen says is the build's own prose, in
// its own words, which `specs/ui.md` asks for in a player's language rather than as
// rules of a system.
//
// STANDALONE WORDS, NOT SUBSTRINGS. `drewWord` requires the word as its own token,
// which is the reading the specification's own phrasing asks for: a screen reading
// "press the spacebar" contains `space` and names no key the specification named, and
// a screen reading "the sharp turn" contains no `P` at all. It is why this item uses
// `drewWord` where the two menu items above it use `drewText`.
//
// WHY THE WORD LIST IS READ OFF THE BUILD'S OWN ROSTER. This item is on BOTH
// checklists, and its requirement is one word longer on one of them, because
// `specs/controls.md` binds `KeyF` under `warhead` and binds nothing to it under
// `base`. The variant is therefore read the only way a suite serving both can read
// it — `carriesTorpedoes`, the harness's own read of whether the build reports a
// torpedo roster. It decides nothing about the SCENARIO, which is the same screen
// either way; it decides only how long the list of keys the specification handed this
// build is.
//
// THE SCREEN IS POSED. `setScreen("howto")` is the direct route to the screen whose
// CONTENT this item grades; reaching it through the title menu is
// `screens/howto-reachable`'s requirement, and driving that route here would fail this
// item for that one's faults. The frame is presented rather than stepped, so nothing
// of the screen's own timing runs under the reading.
//
// WHAT THIS ITEM DOES NOT DECIDE. That any of those keys WORKS — every one of them is
// its own item in `controls` — nor how the screen is reached or left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_WORDS, HOWTO_WORD_TORPEDO } from "../constants";
import {
  captureStill,
  carriesTorpedoes,
  createHarness,
  drewWord,
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

it("names every key specs/controls.md binds, as standalone words", async () => {
  const words = (await carriesTorpedoes(h))
    ? [...HOWTO_WORDS, HOWTO_WORD_TORPEDO]
    : [...HOWTO_WORDS];

  await reachHowto(h);

  const calls = await h.presentCalls();
  await captureStill(h, "howto");

  for (const word of words) {
    assertEqual(
      drewWord(calls, word),
      true,
      `the how-to screen names the key "${word}" as a standalone word (specs/ui.md)`,
    );
  }
});
