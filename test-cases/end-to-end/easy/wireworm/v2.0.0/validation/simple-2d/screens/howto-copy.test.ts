// Wireworm — screens/howto-copy: the how-to screen names the fire key and the
// movement keys, each as a standalone word.
//
// `specs/ui.md`: the controls the how-to screen names "include the fire key,
// written as the standalone word `SPACE`, and the movement keys, written as the
// standalone words `ARROWS` and `WASD`". Those three tokens are the whole of
// what is asserted, and each is matched at word boundaries — so prose that
// merely carries the letters inside a longer word (SPACEBAR, CROSSWORDS) cannot
// satisfy it, while any phrasing that names the key ("SPACE to fire", "[SPACE]",
// "MOVE  ARROWS or WASD") does. Case is ignored: which case a build sets its
// copy in is the build's own typography.
//
// The rest of the screen's copy — the goal, the charged field, the dive, the
// three foes — is NOT asserted. Whether wording "names the chain-arc discharge"
// is not a question a script can decide, so the frame is captured as an image
// and that reading is left to the reviewer.
//
// The screen is posed with the surface's own `setScreen`, so a build that draws
// the right copy behind a broken title menu fails `screens/title-howto` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnTextForms,
  type Harness,
} from "../harness";

/**
 * The tokens `specs/ui.md` requires the screen to name, each as a standalone
 * word: the fire key, and the two ways the movement keys are named.
 */
const KEY_WORDS = ["SPACE", "ARROWS", "WASD"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names SPACE, ARROWS and WASD as standalone words", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "setScreen poses the how-to screen (specs/instrumentation.md)",
  );

  const drawn = await drawFrame(h);
  captureStill(h, "howto");

  // Both as the calls split the copy and as the runs it spells, because each
  // key is held to a boundary on both sides (`drawnTextForms`).
  const texts = drawnTextForms(drawn);
  assertGreaterThan(texts.length, 0, "the how-to screen draws text");
  for (const word of KEY_WORDS) {
    const standalone = new RegExp(`\\b${word}\\b`, "i");
    assertEqual(
      texts.some((text) => standalone.test(text)),
      true,
      `a run of the how-to screen's text names ${word} as a standalone ` +
        "word (specs/ui.md)",
    );
  }
});
