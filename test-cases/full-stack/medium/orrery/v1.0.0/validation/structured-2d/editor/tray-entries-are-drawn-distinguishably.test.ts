// editor/tray-entries-are-drawn-distinguishably — two entries holding different
// part kinds are not drawn the same, and no entry is drawn empty.
//
// THE RULE. "Each entry shows the part's name and its cost from `PART_COSTS`; a
// rise or set entry shows which reagent or product it is. An entry may reuse the
// produced part art `specs/assets.md` lists, and how it is arranged inside its
// rectangle is yours" (`specs/editor.md`, The tray). The arrangement is the
// build's, so what a check can read is the consequence: an entry that shows its
// own name and its own cost cannot be the same picture as one showing a different
// name and a different cost, and an entry showing anything at all is not a blank
// rectangle. The rectangle each is read inside is the same section's: "Entry `k`
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
// THE VERDICT, in two parts. No entry's rectangle is a flat wash: at least
// `MIN_MARKED_SHARE` of its pixels stand away from its own mean colour, which a
// rectangle carrying a name and a number does and a blank one does not. And no two
// of the eight rectangles are the same picture, pixel for pixel.

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
  pixelsDiffering,
  shareAwayFrom,
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

/**
 * The least share of an entry's pixels that stand away from its own mean colour.
 *
 * A slot is `TRAY_W` by `TRAY_SLOT_H` (`208` by `30`), which is `6240` pixels, so
 * this is sixty-two of them — far below what a part's name and its cost cover at
 * any legible size, and far above what a stray anti-aliased edge covers.
 */
const MIN_MARKED_SHARE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every entry marked, and no two entries alike", async () => {
  await openChallengeDocument(h, SIX_KINDS);
  await captureStill(h, "tray");

  const drawn: PixelRect[] = [];
  for (const [slot] of TRAY.entries()) {
    const rectangle = traySlot(slot);
    drawn.push(
      await h.pixelRect(rectangle.x, rectangle.y, rectangle.w, rectangle.h),
    );
  }

  for (const [slot, entry] of TRAY.entries()) {
    const rectangle = drawn[slot] as PixelRect;
    assertGreaterThan(
      shareAwayFrom(rectangle, meanRect(rectangle), CHANNEL_EPSILON),
      MIN_MARKED_SHARE,
      `entry ${slot}, the ${entry.kind} entry, is not drawn empty: it shows the part's name and its cost`,
    );
  }

  for (let a = 0; a < TRAY.length; a += 1) {
    for (let b = a + 1; b < TRAY.length; b += 1) {
      assertGreaterThan(
        pixelsDiffering(drawn[a] as PixelRect, drawn[b] as PixelRect),
        0,
        `entries ${a} (${TRAY[a]?.kind}) and ${b} (${TRAY[b]?.kind}) hold different part kinds, so they are not drawn identically`,
      );
    }
  }
});
