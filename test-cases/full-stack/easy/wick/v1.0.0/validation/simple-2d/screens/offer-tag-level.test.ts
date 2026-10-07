// screens/offer-tag-level — a held item's offer is tagged with its next level.
//
// WHAT THIS DECIDES. One thing: an offer for an item the lamplighter already
// holds carries `LEVEL_LABEL` and the level the item WOULD BECOME, one above
// the level held, rather than the level held or the `NEW` tag that belongs to
// an item not yet held.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`, the offer table): "Tag | `OFFER_NEW_TEXT` (`NEW`)
//   for an item not yet held, else `LEVEL_LABEL` and the level it would become,
//   as `LEVEL 3`."
//   specs/progression.md ("Choosing"): "otherwise `LEVEL_LABEL` (`LEVEL`)
//   followed by the level the item would become", and "A held weapon or
//   passive | Its level rises by `1`", so Taper at level `3` would become `4`.
//   specs/progression.md ("The candidate pool"): "every held base weapon below
//   `MAX_WEAPON_LEVEL` ... each as a `+1 level` offer", which is why Taper at
//   `3` is a candidate.
//
// THE DRIVE. An isolated `playing` run holding Taper at level `3` and nothing
// else, with `taper` posed as the overlay's only offer, opened by the tick a
// queued level-up opens it. One offer on the screen means the tag is read off
// the frame's text with no layout involved. The run's own level is posed well
// away from the tag's number by `isolate`, so the HUD's `LEVEL` label cannot
// supply the reading.
//
// THE TOLERANCE. The tag is matched as `LEVEL_LABEL` followed by the level
// with any run of spaces between them, ignoring case, which is the form
// specs/ui.md spells (`LEVEL 3`), read off both the raw calls and the runs
// they spell so a label and its number drawn as two runs still read; the
// digits must stand as their own token. That the frame carries no `NEW` is
// read as a whole token through `hasToken`, and it is the other half of the
// same rule: the tag is one or the other, never both.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { LEVEL_LABEL, OFFER_NEW_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  holdWeapon,
  isolate,
  openLevelUp,
  textReadings,
  type Harness,
} from "../harness";

let h: Harness;

/** Taper held at 3 becomes 4 (specs/progression.md, "A held weapon ... rises by 1"). */
const HELD_LEVEL = 3;
const OFFERED_LEVEL = HELD_LEVEL + 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tags an offer for Taper held at 3 with LEVEL 4", async () => {
  isolate(h);
  holdWeapon(h, "taper", HELD_LEVEL);
  h.debug.setNextOffers(["taper"]);
  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    opened.run.offers,
    ["taper"],
    "the offer the overlay presents",
  );
  assertEqual(
    opened.run.weapons[0]?.level,
    HELD_LEVEL,
    "the level Taper is held at while the offer is drawn",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "level");

  const lines = textReadings(calls);
  const tag = new RegExp(`${LEVEL_LABEL}\\s*${OFFERED_LEVEL}(?![\\w])`, "i");
  assertEqual(
    // Both readings, so the tag is found whether the level was drawn a glyph
    // at a time (the run) or a plain call the run rule merged into its
    // neighbour (the raw call).
    lines.some((line) => tag.test(line)),
    true,
    `the tag on an offer for Taper held at ${HELD_LEVEL} (${LEVEL_LABEL} ${OFFERED_LEVEL})`,
  );
  assertEqual(
    hasToken(lines, OFFER_NEW_TEXT),
    false,
    `the ${OFFER_NEW_TEXT} tag, which belongs to an item not yet held`,
  );
});
