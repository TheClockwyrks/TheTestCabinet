// campaign/course-permitted-is-a-part-list — every challenge's permitted list is
// a legal part list.
//
// THE RULE. "`permitted` is non-empty and lists the part kinds the tray offers,
// in any order and without duplicates. Each entry is one of the kinds of `PARTS`
// in `specs/parts.md` up to and including `void`. The tray derives one `rise` per
// reagent and one `set` per product" (`specs/formats.md`, Challenges). Every
// challenge of the campaign "is well formed under `specs/formats.md`"
// (`specs/modes/campaign.md`, The course).
//
// WHY `rise` AND `set` ARE EXCLUDED. They are the two kinds the tray DERIVES, one
// per reagent and one per product, and each derived entry carries the index of
// the molecule it belongs to. A `rise` written into `permitted` would be an entry
// belonging to no reagent, so the two kinds at the end of `PARTS` are exactly the
// two `permitted` may not name.
//
// ORDER IS NOT DECIDED HERE. The list is offered "in any order"; the tray's own
// order is `specs/editor.md`'s and belongs to the editor's points.
//
// THE POSE. Each challenge of the course opened in the editor in turn, which is
// where the tray it derives is drawn and where `challenge.permitted` is reported.
//
// THE VERDICT. Every challenge's `permitted` is non-empty, holds no kind twice,
// and names only kinds of `PARTS` up to and including `void`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { PERMITTED_KINDS } from "../formats";
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

it("offers a non-empty, duplicate-free list of placeable kinds in every challenge", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    await captureStill(h, "tray");

    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;

    const at = `campaign challenge ${index + 1}`;
    assertGreaterThan(
      view.permitted.length,
      0,
      `${at}'s permitted list is non-empty`,
    );
    assertEqual(
      new Set(view.permitted).size,
      view.permitted.length,
      `${at}'s permitted list holds no duplicate, and it is ${JSON.stringify(view.permitted)}`,
    );
    for (const kind of view.permitted) {
      assertContains(
        PERMITTED_KINDS as readonly string[],
        kind,
        `${at}'s permitted list names only kinds of PARTS up to and including void, so never rise or set`,
      );
    }
  }
});
