// campaign/course-tray-within-max — no challenge of the course derives a tray
// that overflows.
//
// THE RULE. "The tray derives one `rise` per reagent and one `set` per product.
// The derived tray, `permitted` plus one entry per reagent and per product, holds
// at most `TRAY_MAX` (`16`) entries" (`specs/formats.md`, Challenges). Every
// challenge of the campaign "is well formed under `specs/formats.md`"
// (`specs/modes/campaign.md`, The course).
//
// WHY THE BOUND IS A REAL ONE. `specs/editor.md` gives the tray a region of the
// stage and a fixed slot height, so a seventeenth entry has nowhere on screen to
// go: the bound is what keeps every offered kind reachable by the pointer.
//
// WHAT IS COUNTED. The DERIVED tray, which is the arithmetic the sentence states
// — `permitted.length + reagents.length + products.length` — rather than anything
// read off a build's own tray widget, so a build that drew its tray differently
// is measured against the document all the same.
//
// THE POSE. The whole course read out of the editor, then the challenge with the
// WIDEST derived tray opened again for the picture, which is the one closest to
// the bound.
//
// THE VERDICT. Every challenge's derived tray holds at most `TRAY_MAX` entries.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { TRAY_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives a tray of at most TRAY_MAX entries in every challenge", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const trays: number[] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;
    trays.push(
      view.permitted.length + view.reagents.length + view.products.length,
    );
  }

  const widest = trays.indexOf(Math.max(...trays));
  await openChallenge(h, "campaign", widest);
  await captureStill(h, "tray");

  for (const [index, entries] of trays.entries()) {
    assertLessThanOrEqual(
      entries,
      TRAY_MAX,
      `campaign challenge ${index + 1}'s derived tray — its permitted kinds plus one rise per reagent and one set per product — holds at most TRAY_MAX entries`,
    );
  }
});
