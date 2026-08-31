// screens/howto-shows-the-controls — the how-to screen names every key the game
// binds.
//
// THE RULE. `specs/ui.md` describes `howto` as how to play, and fixes one part of
// it exactly: "the controls it names include every key `specs/controls.md` binds,
// written as the standalone words `ARROWS`, `WASD`, `SPACE`, `ENTER`, `ESC`, `P`
// and `M`" — with `F` added under `warhead`, which binds the torpedo key. A
// how-to screen that leaves a key unnamed leaves a player unable to use it, and a
// how-to screen with nothing on it is the failure this item exists to catch.
//
// THE WORD LIST IS DERIVED, NOT WRITTEN OUT. It is built from `BINDINGS` — the
// keys the build was seeded to register (`specs/controls.md`) — through the
// mapping the specification itself states: the four arrows are named together as
// `ARROWS`, the four letter keys of the hand position as `WASD`, and every other
// key by itself. So the same check grades `base` against seven words and
// `warhead` against eight, and it grades the keys the game ACTUALLY binds rather
// than a list that could drift from them.
//
// STANDALONE IS THE READING THE SPECIFICATION ASKS FOR. A word counts only where
// no letter or digit sits either side of it, so the `P` of `PAUSES` does not name
// the pause key and the `M` of `MUTES` does not name the mute key — a screen has
// to write the key. Case and layout are the build's: `specs/ui.md` fixes no type,
// no ordering and no wording around the keys, and the how-to text is explicitly to
// be written "in a player's words", so the words are looked for INSIDE whatever
// lines the build wrote rather than as lines of their own.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game on it
// directly (`specs/instrumentation.md`), because reaching it through the title
// menu would fold `screens/howto-reachable`'s requirement into this one's grade.
//
// WHAT THIS ITEM DOES NOT DECIDE. The rest of the how-to screen's contents —
// `specs/ui.md` lists the goal, the star, the recycled rock and the saucer, and
// leaves the wording of every one of them to the build, so none of them is
// asserted here. Nor how the screen is reached or left, which are its two
// siblings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { boundKeyWords, drawnCopy, textRuns, wordPattern } from "./menu";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names every bound key on the how-to screen, as a standalone word", async () => {
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
  for (const word of boundKeyWords()) {
    assertMatches(
      copy,
      wordPattern(word),
      `the key ${JSON.stringify(word)} named as a standalone word on the ` +
        `how-to screen (specs/ui.md, specs/controls.md)`,
    );
  }
});
