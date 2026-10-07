// Wireworm — screens/title-highlight: the title menu marks which item
// `confirm` would take.
//
// "The highlighted item is drawn distinctly from the others, so a player always
// sees which item `confirm` would take" (specs/ui.md).
//
// The highlight is read as a DIFFERENCE rather than as a treatment, because the
// specification fixes no treatment: a colour, a weight, a marker beside the row
// and a plate behind it are all conformant. So the frame is drawn once with the
// highlight on the first item and once with it on the second, and the two must
// not come out identical — which every one of those treatments satisfies, and a
// screen that marks nothing does not. It is a comparison between two frames of
// the same build, so it fixes no threshold; whether the distinction READS at a
// glance is the reviewer's, from the captured still. A build whose title screen
// animates would satisfy it incidentally, which is the price of not fixing a
// treatment the case deliberately left open.
//
// The copy this reads is `screens/title-screen`'s requirement, not this one's:
// the menu is posed through `poseTitle`, whose `setMenuIndex` is the only thing
// the comparison needs.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseTitle, renderDigest } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the frame differently with the highlight one item on", async () => {
  await poseTitle(h, 0);
  const onFirst = renderDigest(await h.frameCalls());

  await h.debug.setMenuIndex(1);
  const onSecond = renderDigest(await h.frameCalls());
  await captureStill(h, "title");

  assertNotEqual(
    onSecond,
    onFirst,
    `the frame with "${TITLE_ITEMS[1]}" highlighted differs from the one with "${TITLE_ITEMS[0]}" highlighted`,
  );
});
