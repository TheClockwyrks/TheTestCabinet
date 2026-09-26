// instrumentation/title-index-reads-back — the title entry `setTitleIndex` poses
// is the entry `snapshot().titleIndex` reports.
//
// THE RULE. `specs/instrumentation.md`, The screen and the menus:
// `setTitleIndex(index)` "Sets `titleIndex`, the title entry a return to the
// title restores", and the snapshot carries `titleIndex`, the title menu's
// remembered selection. `specs/state.md` fixes what the field IS: "The title
// entry last confirmed ... It is `0` until a title item is activated."
//
// WHY THE POSE EXISTS AT ALL. Four `navigation/` points are about what a title
// entry remembers and what a return restores, and without a pose each of them
// would have to reach its starting value by activating an entry — so a build with
// a broken `HOW TO PLAY` control would fail the restoration points as well as the
// control's own, and the restoration a player actually sees could never be driven
// from a value the naive answer does not already produce.
//
// EVERY TITLE ENTRY IS POSED, because a field read back once could be a constant,
// and they are posed from the last back to the first so the reading never agrees
// with the value `reset` left.
//
// EACH IS READ WITH NO FRAME BETWEEN THE POSE AND THE READING, so what is read is
// the pose rather than an update.
//
// WHAT THIS DOES NOT DECIDE. What the field MEANS — which entry an activation
// writes into it, and what a return to the title restores from it — which is
// `navigation/`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports each posed title entry back through snapshot", async () => {
  await openTitle(h);

  const read: { posed: number; reported: number }[] = [];
  for (let index = TITLE_ITEMS.length - 1; index >= 0; index -= 1) {
    await h.debug.setTitleIndex(index);
    read.push({ posed: index, reported: (await h.snapshot()).titleIndex });
  }

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // title the last one was made on.
  await captureStill(h, "posed");

  for (const step of read) {
    assertEqual(
      step.reported,
      step.posed,
      `snapshot().titleIndex after setTitleIndex(${step.posed}) — the title ` +
        `menu carries ${TITLE_ITEMS.length} entries ` +
        `(specs/instrumentation.md)`,
    );
  }
});
