// screens/levelup-lists-offers — the overlay lists its offers.
//
// WHAT THIS DECIDES. One thing: the offers are on the frame in the order
// `offers` holds them, one under the next, and the item at `menuIndex` is drawn
// so that moving the highlight changes the picture. What each offer shows, its
// name, its icon, and its tag, is each its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "It shows `LEVEL_UP_TEXT` ... and the offers in
//   `offers`, listed vertically in that order."
//   specs/ui.md ("Presentation"): "On every menu the item at `menuIndex` is
//   drawn distinctly from the others, so a player always sees which item
//   `confirm` would accept."
//   specs/progression.md ("Choosing"): "The offers are listed vertically in the
//   order of `offers`, and the item at `menuIndex` is highlighted."
//   specs/instrumentation.md (`setNextOffers`): the list "is accepted when
//   every id is a candidate of the pool at that moment ... and the overlay then
//   presents exactly that list in that order."
//
// THE DRIVE. An isolated `playing` run holds no weapon and no passive, so every
// base weapon and every passive is a candidate (specs/progression.md, "The
// candidate pool") and the three ids this point names are accepted; the overlay
// is opened by the tick a queued level-up opens it. The order is read as the
// topmost anchor each offer's name was drawn at, which is layout-free: the
// specification fixes no place for a row, only that the rows run down the
// screen in the order of `offers`.
//
// THE HIGHLIGHT, AND ITS CONTROL. Nothing poses `menuIndex`, so the highlight
// is moved with the overlay's own `down` key, which is `levelup-down-moves-
// highlight`'s point; this one reads only whether the PICTURE changed with it.
// Two frames are drawn at `menuIndex` 0 first, and their difference is the
// drift a build that animates its overlay carries; the frame at `menuIndex` 1
// must differ from the one before it by more than that drift, so a build that
// draws every row alike fails and a build that animates does not pass on the
// animation alone.
//
// THE TOLERANCE. The names are matched as words in order and their order as a
// strict inequality between anchors, both layout-free. The highlight is read as
// a pixel count against the drift measured on the same scene.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { STAGE_H, STAGE_W, WEAPON_NAMES, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  pixelsDiffering,
  present,
  tap,
  topAnchorOf,
  type Harness,
} from "../harness";

let h: Harness;

/** Three candidates of an empty loadout's pool, and the names each shows. */
const OFFERS = ["ember", "shard", "glass"] as const;
const NAMES = [WEAPON_NAMES.ember, WEAPON_NAMES.shard, PASSIVES.glass.name];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists the offers down the frame in the order of offers", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "offers");

  const anchors = NAMES.map((name, index) =>
    present(
      topAnchorOf(calls, name),
      `where the frame drew offer ${index}, ${name}`,
    ),
  );
  for (let index = 1; index < anchors.length; index += 1) {
    assertLessThan(
      anchors[index - 1],
      anchors[index],
      `${NAMES[index - 1]} drawn above ${NAMES[index]}, in the order of offers`,
    );
  }

  const first = h.pixelRect(0, 0, STAGE_W, STAGE_H);
  await h.frameDraw();
  const again = h.pixelRect(0, 0, STAGE_W, STAGE_H);
  const drift = pixelsDiffering(first, again);

  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "the highlight moved onto the second offer");
  const highlighted = h.pixelRect(0, 0, STAGE_W, STAGE_H);

  assertGreaterThan(
    pixelsDiffering(again, highlighted),
    drift,
    "pixels the moved highlight changed, over the drift of the same scene",
  );
});
