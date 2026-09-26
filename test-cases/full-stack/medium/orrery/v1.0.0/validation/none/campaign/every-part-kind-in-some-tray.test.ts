// campaign/every-part-kind-in-some-tray — no part kind goes unoffered by the
// course.
//
// THE RULE. "Across the course as a whole, every part kind in `PARTS` appears in
// at least one challenge's tray" (`specs/modes/campaign.md`, The course). `PARTS`
// "holds the twenty-one part kinds" (`specs/parts.md`), the wheel, the piston, the
// track, all twelve transforming sigils, and `rise` and `set` among them.
//
// WHAT A TRAY HOLDS IS DERIVED, NOT DECLARED. "The tray offers what the challenge
// permits. Its entries are, in order: the challenge's `permitted` part kinds, in
// the order of `PARTS`; then one `rise` per reagent, in reagent order; then one
// `set` per product, in product order" (`specs/editor.md`, The tray). So a
// challenge's tray is a function of the challenge document alone, which is what
// `derivedTray` computes, and this check reads it off the open challenge the
// snapshot reports rather than off any pixel: `challenge` carries "`reagents`,
// `products`, `permitted`" "exactly the formats of specs/formats.md"
// (`specs/instrumentation.md`). Every challenge with at least one reagent and one
// product therefore offers `rise` and `set` whatever it permits, which is why
// those two are read the same way as the other nineteen rather than assumed.
//
// HOW THE COURSE IS WALKED. `openChallenge(mode, index)` puts each shipped
// challenge in the editor, and "Neither operation touches progress: the unlocked
// count, the solved sets, the records, the per-challenge stashes, and both `last`
// figures stand as they are" (`specs/instrumentation.md`), so walking the whole
// course leaves the session exactly as it found it. "A locked row opens like any
// other", so the walk reaches the challenges the fresh course has not unlocked.
//
// THE VERDICT. The union of the derived trays over the whole course holds all
// twenty-one kinds, and a failure names the kinds no tray offered.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { PARTS, type PartName } from "../constants";
import { derivedTray } from "../formats";
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

it("offers every one of the twenty-one part kinds in some challenge's tray", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;

  const offered = new Set<PartName>();
  /** The challenge whose tray brought the most kinds nothing before it offered. */
  let widest = { index: 0, added: -1 };
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const open = (await h.snapshot()).challenge;
    assertNotNull(
      open,
      `opening campaign challenge ${index + 1} puts it in the editor, so the ` +
        "snapshot reports the challenge its tray is derived from",
    );
    if (open === null) continue;
    let added = 0;
    for (const entry of derivedTray(open)) {
      if (!offered.has(entry.kind)) added += 1;
      offered.add(entry.kind);
    }
    if (added > widest.added) widest = { index, added };
  }

  // The evidence is the tray that brought the most kinds of its own, drawn in the
  // editor over the challenge that derives it.
  await openChallenge(h, "campaign", widest.index);
  await h.advance(1);
  await captureStill(h, "trays");

  assertDeepEqual(
    PARTS.filter((kind) => !offered.has(kind)),
    [],
    "every part kind in PARTS appears in at least one challenge's tray across " +
      "the course, and these are the kinds no tray offered",
  );
});
