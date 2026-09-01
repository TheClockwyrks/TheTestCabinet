// screens/menu-index-resets-on-entry — arriving on any screen sets `menuIndex`
// to `0`.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Menu navigation"): "`menuIndex`
// is `0` on entering every screen, and on a screen with no menu it stays `0`."
// specs/controls.md ("What each screen reads") repeats it word for word. Each
// screen's own section says the same of its arrival: "`menuIndex` is `0` on
// arriving" on `title` and on the end screens, "`menuIndex` is `0` on opening"
// on `levelup`, "`menuIndex = 0`" on the `howto` and `chest` rows and on the
// two transitions back to `title`. specs/instrumentation.md fixes it for the
// posed transitions too: `setScreen(name)` "Enters screen `name` ... exactly as
// the real transition into it from the current screen enters it, with
// `menuIndex` `0`."
//
// WHY THE WORLD IS POSED AS IT IS. All eight screens are entered in one drive,
// each by a real transition rather than a pose where a real one exists, and the
// index is read the moment each is arrived at. Four of them are entered from a
// screen whose highlight had been moved to `1` first, which is what makes the
// requirement visible: `howto` from a title on its second item, `playing` from
// an overlay on its second offer, `levelup` from an overlay on its second offer
// with another level-up still queued, and `title` from an end screen on its
// second item. The other four — `chest`, `paused`, `fallen` and `dawn` — are
// only ever entered from `playing`, which carries no highlight to move, so each
// is entered from there and read on arrival. The night is isolated before the
// run screens, so nothing spawns into a tick and no gain opens an overlay this
// drive did not queue.
//
// THE TOLERANCE. None: an index is an exact comparison, and each screen is
// asserted as well so an arrival that never happened fails rather than passing
// on the index of the screen it never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("arrives on each of the eight screens with menuIndex 0", async () => {
  // howto, from a title standing on its second item.
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the drive starts on");
  const onSecond = await pressDown(h);
  assertEqual(
    onSecond.menuIndex,
    1,
    "the title's highlight before entering howto",
  );
  assertHighlight(await pressConfirm(h), "howto", 0, "on arriving at howto");
  assertHighlight(await pressBack(h), "title", 0, "on returning to the title");

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
