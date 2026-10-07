// screens/menu-index-resets-on-entry — arriving on any screen but `title` sets
// `menuIndex` to `0`, and arriving on `title` selects the entry that led away.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Menu navigation"): "`menuIndex`
// is `0` on entering every screen but `title`, which selects the entry that led
// away from it as the `title` section above states, and on a screen with no
// menu it stays `0`." specs/controls.md ("What each screen reads") repeats it.
// Each screen's own section says the same of its arrival: "`menuIndex` is `0`
// on arriving" on `almanac`, `paused` and the end screens, "`menuIndex` is `0`
// on opening" on `levelup`, "`menuIndex = 0`" on the `howto` and `chest` rows.
// specs/ui.md ("`title`") gives the exception: "Arriving here selects the entry
// the arriving transition led away from", `THE ALMANAC` after `back` on the
// almanac, `HOW TO PLAY` after `back` on the how-to screen, and
// `LIGHT THE LAMP` after `TITLE` on an end screen.
//
// WHY THE WORLD IS POSED AS IT IS. All nine screens are entered in one drive,
// each by a real transition rather than a pose where a real one exists, and the
// index is read the moment each is arrived at. Five of them are entered from a
// screen whose highlight had been moved off `0` first, which is what makes the
// requirement visible: `almanac` from a title on its second item, `howto` from
// a title on its third, `playing` from an overlay on its second offer,
// `levelup` from an overlay on its second offer with another level-up still
// queued, and `title` from an end screen on its second item. The other four —
// `chest`, `paused`, `fallen` and `dawn` — are only ever entered from
// `playing`, which carries no highlight to move, so each is entered from there
// and read on arrival. The night is isolated before the run screens, so nothing
// spawns into a tick and no gain opens an overlay this drive did not queue.
//
// THE TOLERANCE. None: an index is an exact comparison, and each screen is
// asserted as well so an arrival that never happened fails rather than passing
// on the index of the screen it never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openChest,
  poseScreen,
  pressBack,
  pressConfirm,
  pressDown,
  pressPause,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertHighlight,
  endDawn,
  endFallen,
  night,
  openOffers,
} from "./stage";

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** Where `THE ALMANAC` and `HOW TO PLAY` sit in `TITLE_ITEMS`. */
const ALMANAC_ITEM = TITLE_ITEMS.indexOf("THE ALMANAC");
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("arrives on each of the nine screens with the index the rule gives it", async () => {
  /**
   * Move the title's highlight onto `item` with real `down` presses, from
   * wherever the arriving transition left it: the title "selects the entry that
   * led away from it", so the starting index is not always `0`.
   */
  const highlight = async (item: number): Promise<WickSnapshot> => {
    const title = await h.snapshot();
    assertEqual(title.screen, "title", "the screen the highlight is moved on");
    const steps =
      (item - title.menuIndex + TITLE_ITEMS.length) % TITLE_ITEMS.length;
    let posed = title;
    for (let i = 0; i < steps; i += 1) posed = await pressDown(h);
    assertEqual(
      posed.menuIndex,
      item,
      "the title's highlight before the item is taken",
    );
    return posed;
  };

  // almanac, from a title standing on its second item.
  await highlight(ALMANAC_ITEM);
  assertHighlight(
    await pressConfirm(h),
    "almanac",
    0,
    "on arriving at almanac",
  );
  assertHighlight(
    await pressBack(h),
    "title",
    ALMANAC_ITEM,
    "on returning to the title from the almanac",
  );

  // howto, from a title standing on its third item.
  await highlight(HOW_TO_PLAY);
  assertHighlight(await pressConfirm(h), "howto", 0, "on arriving at howto");
  assertHighlight(
    await pressBack(h),
    "title",
    HOW_TO_PLAY,
    "on returning to the title from the how-to screen",
  );

  // playing, from an overlay standing on its second offer.
  await night(h);
  await openOffers(h, OFFERS, 1);
  assertEqual(
    (await pressDown(h)).menuIndex,
    1,
    "the overlay's highlight before it is accepted",
  );
  assertHighlight(
    await pressConfirm(h),
    "playing",
    0,
    "on arriving at playing",
  );

  // levelup, from an overlay standing on its second offer with one still queued.
  await openOffers(h, OFFERS, 2);
  assertEqual(
    (await pressDown(h)).menuIndex,
    1,
    "the first overlay's highlight before it is accepted",
  );
  assertHighlight(
    await pressConfirm(h),
    "levelup",
    0,
    "on arriving at the next overlay",
  );
  await h.debug.choose(0);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen the last overlay left",
  );

  // chest, paused, fallen and dawn, each from playing, which holds no highlight.
  assertHighlight(
    await openChest(h),
    "chest",
    0,
    "on arriving at the chest overlay",
  );
  await poseScreen(h, "playing");
  assertHighlight(await pressPause(h), "paused", 0, "on arriving at paused");
  await pressPause(h);
  assertHighlight(await endFallen(h), "fallen", 0, "on arriving at fallen");

  // title, from an end screen standing on its second item.
  assertEqual(
    (await pressDown(h)).menuIndex,
    1,
    "the end screen's highlight before back",
  );
  assertHighlight(
    await pressBack(h),
    "title",
    0,
    "on returning to the title from an end screen",
  );

  await poseScreen(h, "playing");
  assertHighlight(await endDawn(h), "dawn", 0, "on arriving at dawn");
  await captureStill(h, "reset");
});
