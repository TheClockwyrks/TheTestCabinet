// Spectra — screens/howto-content: the how-to screen names the keys and the bands.
//
// THE RULE. `specs/ui.md` leaves almost all of the how-to screen to the build —
// it is "written in a player's words rather than as rules of a system" — and then
// fixes exactly five tokens it must contain: "The controls it names include the
// movement keys, written as the standalone words `ARROWS` and `AD`, and the fire
// key, written as the standalone word `SPACE`. It names both bands by their labels
// from `BAND_LABELS`, `CYAN` and `MAGENTA`." Those five are the whole of what a
// script may decide here, and they are what this point decides.
//
// STANDALONE, NOT SUBSTRING. `specs/ui.md` says "standalone words", so each token
// is matched at word boundaries with `drewWord`: a screen reading "press the
// spacebar" contains `space` and has not named the key the specification named,
// and a screen reading "READY" contains neither band. `drewWord` ignores case, so
// a build that draws its prose in sentence case still passes.
//
// THE SCREEN IS REACHED DIRECTLY. `setScreen` puts the game on `howto` without
// touching the title menu or a key, so a build whose confirm is broken loses
// `screens/howto-reachable` and not this point as well.
//
// WHAT IS NOT ASSERTED. Everything else on the screen: whether the prose covers
// the goal, the shield, the flip's cost, the three drones, the meter or the
// discharge is not a question a script can decide without asserting words
// `specs/ui.md` deliberately did not fix. The captured image is what a reviewer
// decides that from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  BAND_LABELS,
  BANDS,
  HOWTO_FIRE_KEY,
  HOWTO_MOVE_KEYS,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewWord,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the movement keys, the fire key and both band labels", async () => {
  await h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the game is on the how-to-play screen (specs/instrumentation.md)",
  );

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  for (const word of [...HOWTO_MOVE_KEYS, HOWTO_FIRE_KEY]) {
    assertTrue(
      drewWord(calls, word),
      `the how-to screen naming ${word} as a standalone word — it names the ` +
        "movement keys as ARROWS and AD and the fire key as SPACE " +
        "(specs/ui.md)",
    );
  }
  for (const band of BANDS) {
    assertTrue(
      drewWord(calls, BAND_LABELS[band]),
      `the how-to screen naming the ${band} band by its BAND_LABELS label ` +
        `${BAND_LABELS[band]} (specs/ui.md)`,
    );
  }
});
