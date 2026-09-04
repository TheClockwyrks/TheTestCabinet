// instrumentation/overlay-shows-on-the-backtick-key — the backtick key brings the
// debug overlay onto the frame.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`. Under the engineless
// runtime the overlay is the build's own layer: "It draws the registered sources,
// the backtick key (`KeyboardEvent.code` `Backquote`) shows and hides it". The key
// is fixed by its `KeyboardEvent.code`, so the check presses `Backquote` itself
// rather than a registered action — the overlay belongs to the runtime layer and
// is bound outside the game's own action registry.
//
// THIS POINT IS SCOPED TO `none`. Under either engine the same key does the same
// thing, and it is the engine that does it: "Drawing the panel, toggling it with
// the backtick key (`KeyboardEvent.code` `Backquote`), and keeping it read-only
// are the engine's." Registering the sources is the whole of Orrery's part there,
// and that is graded by its own points.
//
// WHAT "DRAWS THE OVERLAY" IS READ AS. The panel shows "the values the game
// registers with it as diagnostic sources", so a panel that came onto a frame put
// text on it that was not on the frame before. The reading is the multiset
// difference of the two frames' text draws, which counts a line the game's own
// readout already drew when the panel draws it a second time, and which does not
// care where on the stage the panel sits, how it is styled, or what it says.
//
// THE WORLD IS HELD STILL under the press — the editor over one posed challenge,
// with no run started — so the only thing that changes across the two frames this
// check draws is the panel itself.
//
// THE VERDICT is the first press alone. The overlay "is off when the game starts",
// so from a fresh build that press is the one that draws it: the frame after it
// carries text the frame before it did not. What the SECOND press does is
// `overlay-hides-on-a-second-backtick`, and neither point stands on the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnText,
  openChallengeDocument,
  toggleOverlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The strings in `texts` left after removing `baseline`, as a multiset. */
function addedTexts(
  texts: readonly string[],
  baseline: readonly string[],
): string[] {
  const remaining = [...baseline];
  return texts.filter((text) => {
    const index = remaining.indexOf(text);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

it("draws the overlay over the game on the backtick key", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const before = drawnText(await h.frameCalls());

  await toggleOverlay(h);
  const after = drawnText(await h.frameCalls());
  await captureStill(h, "shown");

  assertGreaterThan(
    addedTexts(after, before).length,
    0,
    "the backtick key draws the debug overlay over the game: the frame carries text it did not carry before the press",
  );
});
