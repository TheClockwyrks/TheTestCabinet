// instrumentation/overlay-hides-on-a-second-backtick — pressing the backtick key
// again takes the debug overlay off the frame.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`: the backtick key
// (`KeyboardEvent.code` `Backquote`) "shows and hides it". A key read once tells
// you nothing about the way back, which is what this point is: from shown to gone.
//
// THIS POINT IS SCOPED TO `none`, for the reason
// `overlay-shows-on-the-backtick-key` gives: under either engine the toggle is the
// engine's, and Orrery's part there is registering the sources.
//
// THE WORLD is the editor over one posed challenge, with no run started, so the
// only thing that changes across the three frames this check draws is the panel
// itself. The FIRST press is this check's posing step — the point that decides
// what it does is `overlay-shows-on-the-backtick-key` — and the second press is
// the verdict.
//
// THE VERDICT. The frame after the second press draws exactly what it drew before
// either press: no line the panel put on it is left, by the multiset difference
// `overlay-shows-on-the-backtick-key` reads the panel by, and no line the panel
// was covering is missing from it. The two readings are one reading of one
// behaviour — a panel half taken off fails on the first, and a panel that took
// the game's own readout down with it fails on the second.

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

it("removes the overlay again on the next press of the backtick key", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const before = drawnText(await h.frameCalls());

  await toggleOverlay(h);
  const shown = drawnText(await h.frameCalls());
  assertGreaterThan(
    addedTexts(shown, before).length,
    0,
    "the first press put the panel on the frame, which is the world this point reads",
  );

  await toggleOverlay(h);
  const hidden = drawnText(await h.frameCalls());
  await captureStill(h, "hidden");

  assertDeepEqual(
    addedTexts(hidden, before),
    [],
    "pressing the backtick key again removes the overlay: no line it drew is left on the frame",
  );
  assertEqual(
    hidden.length,
    before.length,
    "and no line it was covering is missing from it, so the frame draws exactly what it drew before either press",
  );
});
