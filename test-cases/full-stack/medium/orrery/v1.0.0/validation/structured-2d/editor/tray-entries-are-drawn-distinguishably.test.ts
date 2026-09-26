// editor/tray-entries-are-drawn-distinguishably — every entry carries its own
// words, and none is drawn empty.
//
// THE RULE. "Each entry shows the part's name and its cost from `PART_COSTS`; a
// rise or set entry shows which reagent or product it is. An entry may reuse the
// produced part art `specs/assets.md` lists, and how it is arranged inside its
// rectangle is yours" (`specs/editor.md`, The tray). The arrangement is the
// build's, and how well one entry reads against the next is the reviewer's. What a
// check reads is that each entry carries what the sentence gives it: the frame
// anchored a text run inside that entry's rectangle, and the rectangle is not a
// blank wash. The rectangle each is read inside is the same section's: "Entry `k`
// ... occupies the rectangle from `(TRAY_X0, TRAY_Y0 + k * TRAY_SLOT_H)` to
// `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`".
//
// THE CONFIGURATION. A challenge permitting six mechanisms — `arm`, `biarm`,
// `triarm`, `hexarm`, `piston` and `wheel`, whose names all differ and whose
// `PART_COSTS` run `20`, `30`, `40`, `60`, `40` and `30` — with one reagent and
// one product, so the tray is eight entries and every one of them holds a
// different kind. Nothing is placed and nothing is pressed, so no entry is spent
// and no drag's ghost is on the stage: what is read is the tray at rest.
//
// THE VERDICT, in two parts. The frame anchored at least one run of text inside
// each of the eight rectangles, which is how a name and a cost reach a slot. And
// no entry's rectangle is a flat wash: some of its pixels stand away from its own
// mean colour, which a rectangle carrying a name and a number does and a blank one
// does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { traySlot } from "../field";
import { challenge, derivedTray, loneMote } from "../formats";
import {
  captureStill,
  CHANNEL_EPSILON,
  createHarness,
  meanRect,
  openChallengeDocument,
  shareAwayFrom,
  textDraws,
  type Harness,
  type PixelRect,
} from "../harness";

/** Six permitted mechanisms, one reagent and one product: eight distinct entries. */
const SIX_KINDS = challenge({
  name: "Six Kinds",
  reagents: [loneMote("dust")],
  products: [loneMote("dust")],
  permitted: ["arm", "biarm", "triarm", "hexarm", "piston", "wheel"],
});

/** The eight entries `specs/editor.md` derives, in the order it derives them. */
const TRAY = derivedTray(SIX_KINDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every entry with its own words, and none of them empty", async () => {
  await openChallengeDocument(h, SIX_KINDS);
  await h.advance(1);
  await captureStill(h, "tray");

  const runs = textDraws(await h.lastCalls());
  const drawn: PixelRect[] = [];
  for (const [slot] of TRAY.entries()) {
    const rectangle = traySlot(slot);
    drawn.push(
      await h.pixelRect(rectangle.x, rectangle.y, rectangle.w, rectangle.h),
    );
  }

  for (const [slot, entry] of TRAY.entries()) {
    const rectangle = traySlot(slot);
    const inside = runs.filter(
      (run) =>
        run.text.trim() !== "" &&
        run.x >= rectangle.x &&
        run.x < rectangle.x + rectangle.w &&
        run.y >= rectangle.y &&
        run.y < rectangle.y + rectangle.h,
    );
    assertGreaterThan(
      inside.length,
      0,
      `entry ${slot}, the ${entry.kind} entry, carries a run of text of its own: specs/editor.md gives it the part's name and its cost from PART_COSTS`,
    );

    const picture = drawn[slot] as PixelRect;
    assertGreaterThan(
      shareAwayFrom(picture, meanRect(picture), CHANNEL_EPSILON),
      0,
      `entry ${slot}, the ${entry.kind} entry, is not drawn empty: its rectangle carries paint standing off its own ground`,
    );
  }
});
