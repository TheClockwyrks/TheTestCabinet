// screens/title-how-to-opens — the title's `HOW TO PLAY` moves to `howto`.
//
// `specs/screens.md`, the `title` screen's item table: "`HOW TO PLAY` — Moves to
// `howto`." `specs/controls.md` fixes how a control is activated: "Either kind of
// gesture activates a control when one control's hit region holds both the press
// point and the release point."
//
// THE REGION IS THE BUILD'S OWN. `specs/controls.md` leaves each item's hit
// region to the build and `specs/instrumentation.md` has the build report it, so
// the press is made at the middle of what `menuItemRect(TITLE_HOW_TO_ITEM)`
// answered with. Any layout passes; a build that reports a region it does not
// answer on fails.
//
// THE ITEM INDEX IS THE DISTINGUISHING VALUE. `NEW GAME` is item `0` of the same
// menu and `HOW TO PLAY` is item `1`, so a build that reported the two regions
// the other way round, or that treated the whole panel as one control, deals and
// reads as `playing` rather than reading as `howto` — a different answer, not a
// silent pass. The other item is `screens/title-new-game-enters-play`, and the
// table is left empty here so that a build which dealt by mistake is visible in
// the captured frame as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  openTitle,
  type Harness,
} from "../harness";

/** One frame, so the canvas carries the screen the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen", async () => {
  await openTitle(h);

  // The middle of the region the build reports for its own HOW TO PLAY item.
  const press = await menuPoint(h, TITLE_HOW_TO_ITEM);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the title's HOW TO PLAY reached (specs/screens.md)",
  );
});
