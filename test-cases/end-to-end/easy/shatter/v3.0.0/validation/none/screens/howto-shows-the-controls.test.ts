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
// THE WORD LIST IS THE COMMON ONE, AND IT IS NOT READ OFF THE BUILD. This item is on
// BOTH checklists and asserts the same list on each: the keys `specs/controls.md`
// binds under every variant. `warhead` binds one key more — `KeyF`, for the torpedo —
// and that word is `screens/howto-names-the-torpedo-key`, an item of the warhead
// checklist alone. Branching here on whether the build happens to report a torpedo
// roster would make the requirement a function of what the build implemented: a
// `warhead` build that wrote no torpedo at all would be asked for one word fewer and
// pass, while one that wrote the torpedo and forgot to name its key would fail. The
// variant's own additions are their own items, so each fails on its own and neither
// grades a build against itself.
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
import { HOWTO_WORDS } from "../constants";
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

it("names every key specs/controls.md binds, as standalone words", async () => {
  await reachHowto(h);

  const calls = await presentCalls(h);
  await captureStill(h, "howto");

  for (const word of HOWTO_WORDS) {
    assertEqual(
      drewWord(calls, word),
      true,
      `the how-to screen names the key "${word}" as a standalone word (specs/ui.md)`,
    );
  }
});
