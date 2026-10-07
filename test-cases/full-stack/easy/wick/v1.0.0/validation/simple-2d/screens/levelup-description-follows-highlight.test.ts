// screens/levelup-description-follows-highlight — the line follows the highlight.
//
// WHAT THIS DECIDES. One thing: on an overlay holding three offers, the line
// beneath the list is the FIRST offer's while `menuIndex` is 0 and the SECOND
// offer's once the highlight moves onto it, so the description tracks the
// highlight rather than the list's head. That a line is drawn at all, over the
// three kinds of offer, is `levelup-shows-description`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "Beneath the offer list the overlay draws one more
//   line: the description of the offer at `menuIndex`, on one line", and "`up`
//   and `down` move the highlight and wrap at both ends". One line, of the
//   offer at `menuIndex`, is what makes the other offer's line absent.
//   specs/controls.md ("What each screen reads"): "`levelup` | none | `up`,
//   `down` move the highlight, wrapping", and `down` is `ArrowDown`, `KeyS`.
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order."
//
// THE DRIVE. An isolated `playing` run holding nothing, so all three posed ids
// are candidates of the pool (specs/progression.md); the overlay is opened by
// the tick a queued level-up opens it, which leaves the highlight on the first
// offer with no key pressed; one frame is drawn and read, then one real
// `ArrowDown` over one frame, which ticks nothing since `levelup` advances
// nothing (specs/ui.md), and the frame it drew is read again. The two offers
// this point reads are a weapon and a weapon whose lines share no run of words,
// so neither line can be found in the other.
//
// THE TOLERANCE. Each line is matched as a substring of the frame's text
// through the shared harness's `drewTextAnywhere`, ignoring case and whitespace
// across every run the frame drew, which admits any font, spacing, and line wrap;
// nothing about where the line sits is read, since specs/ui.md fixes no layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { WEAPON_DESCRIPTIONS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";
import { drewTextAnywhere } from "../case-harness/text";

let h: Harness;

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "shard", "glass"] as const;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the second offer's line in place of the first's", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen ArrowDown is pressed on");
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "the highlight before ArrowDown");

  const { calls: first } = await h.frameDraw();
  assertEqual(
    drewTextAnywhere(first, WEAPON_DESCRIPTIONS.ember),
    true,
    "the first offer's line, under the highlight on the first offer",
  );
  assertEqual(
    drewTextAnywhere(first, WEAPON_DESCRIPTIONS.shard),
    false,
    "the second offer's line, under the highlight on the first offer",
  );

  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "the highlight after one ArrowDown");

  const { calls: second } = await h.frameDraw();
  captureStill(h, "followed");
  assertEqual(
    drewTextAnywhere(second, WEAPON_DESCRIPTIONS.shard),
    true,
    "the second offer's line, under the highlight on the second offer",
  );
  assertEqual(
    drewTextAnywhere(second, WEAPON_DESCRIPTIONS.ember),
    false,
    "the first offer's line, under the highlight on the second offer",
  );
});
