// instrumentation/overlay-toggle — the backtick key shows the debug overlay, and
// pressing it again takes it away.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`. Under the engineless
// runtime the overlay is the build's own layer: "It draws the registered sources,
// the backtick key (`KeyboardEvent.code` `Backquote`) shows and hides it". Under
// either engine the same key does the same thing, and it is the engine that owns
// it: "Drawing the panel, toggling it with the backtick key (`KeyboardEvent.code`
// `Backquote`), and keeping it read-only are the engine's." The key is fixed by
// its `KeyboardEvent.code`, so the check presses `Backquote` itself rather than a
// registered action — the overlay "belongs to the runtime layer" and is bound
// outside the game's own action registry in every case.
//
// WHAT "DRAWS THE OVERLAY" IS READ AS. The panel shows "the values the game
// registers with it as diagnostic sources", so a panel that came onto a frame put
// text on it that was not on the frame before, and a panel that went off took text
// away. The reading is the multiset difference of the two frames' text draws,
// which counts a line the game's own readout already drew when the panel draws it
// a second time, and which does not care where on the stage the panel sits, how it
// is styled, or what it says.
//
// THE WORLD IS HELD STILL under the toggle — the editor over one posed challenge,
// with no run started — so the only thing that changes across the three frames
// this check draws is the panel itself.
//
// THE VERDICT IS BOTH PRESSES, IN THE ORDER THE RULE STATES THEM. The overlay "is
// off when the game starts", so from a fresh build the first press is the one that
// draws it: the frame after it carries text the frame before it did not. The second
// press takes it away again, leaving the frame drawing exactly what it drew before
// either press — the same strings, the same number of times. A build whose key does
// nothing fails the first half; one that shows the panel and cannot take it away
// again fails the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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

it("draws the overlay on the backtick key and removes it on the next press", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const before = drawnText(await h.frameCalls());

  await toggleOverlay(h);
  const afterFirst = drawnText(await h.frameCalls());
  await captureStill(h, "shown");

  await toggleOverlay(h);
  const afterSecond = drawnText(await h.frameCalls());

  assertGreaterThan(
    addedTexts(afterFirst, before).length,
    0,
    "the backtick key draws the debug overlay over the game",
  );
  assertDeepEqual(
    addedTexts(afterSecond, before),
    [],
    "pressing the backtick key again removes it: no line it drew is left on the frame",
  );
  assertEqual(
    afterSecond.length,
    before.length,
    "and no line it was covering is missing from it, so the frame draws exactly what it drew before either press",
  );
});
