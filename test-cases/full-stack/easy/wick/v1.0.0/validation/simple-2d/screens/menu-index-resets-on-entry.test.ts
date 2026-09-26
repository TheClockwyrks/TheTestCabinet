// screens/menu-index-resets-on-entry — arriving anywhere sets the highlight
// the rule gives that arrival.
//
// WHAT THIS DECIDES. One thing, over all nine screens: no screen inherits the
// highlight of the screen before it. `menuIndex` reads 0 on arrival everywhere
// but `title`, which selects the entry the arriving transition led away from.
// The nine share one point because they exercise one rule the same way.
//
// THE SPEC IT RESTS ON.
//   specs/state.md (`WickState`): "`menuIndex`: the highlighted item on
//   whichever vertical menu `screen` is showing. It is `0` on entering every
//   screen but `title`, which selects the entry that led away from it as
//   `specs/ui.md` states, and on a screen with no menu it stays `0`."
//   specs/controls.md ("What each screen reads"): the same sentence.
//   specs/ui.md: "`menuIndex` is `0` on arriving" on `paused`, "`menuIndex` is
//   `0` on opening" on `levelup`, and "`menuIndex`, `almanacTab`, and
//   `almanacScroll` all `0`" on `almanac`; `TITLE` on an end screen "returns to
//   `title` with `LIGHT THE LAMP` selected". `chest` states no index of its
//   own, so the rule above is the whole of what it must obey.
//   specs/progression.md ("Choosing"): "When level-ups remain queued the next
//   overlay opens immediately, with a fresh pool ... otherwise `screen` returns
//   to `playing`", both of which are arrivals this point reads.
//
// THE DRIVE, AND WHERE THE HIGHLIGHT COMES FROM. Every arrival is made through
// the real transition into the screen, not through `setScreen`, which sets the
// index by definition and would decide nothing. Five of the nine can be entered
// FROM a screen carrying a highlight, and those are driven that way, with the
// source's index moved off `0` and asserted first: `almanac` from the title's
// second item, `howto` from the title's third, `levelup` from an overlay whose
// second offer was accepted with another level-up queued, `playing` from an
// overlay whose second offer was accepted with none queued, and `title` from
// the end screen's second item. The other four are only ever entered from
// `playing`, whose index is always `0`, so they are entered from there:
// `paused` by the pause key, `chest` by the tick that collects one, and
// `fallen` and `dawn` by the ticks that end a run each way.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { DAWN_TICK, END_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

/** Reset to the title and walk the highlight down to `TITLE_ITEMS[index]`. */
async function highlightTitleItem(index: number): Promise<void> {
  h.reset();
  let staged = h.snapshot();
  for (let press = 0; press < index; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(
    staged.menuIndex,
    index,
    `the title's highlight before Enter (${TITLE_ITEMS[index]})`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("arrives on every screen with the highlight the rule gives it", async () => {
  // almanac, entered from the title with its second item highlighted.
  await highlightTitleItem(TITLE_ITEMS.indexOf("THE ALMANAC"));
  const almanac = await tap(h, "Enter");
  assertEqual(
    almanac.screen,
    "almanac",
    "the screen the title's second item opened",
  );
  assertEqual(almanac.menuIndex, 0, "the highlight on arriving at almanac");

  // howto, entered from the title with its third item highlighted.
  await highlightTitleItem(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  const howto = await tap(h, "Enter");
  assertEqual(
    howto.screen,
    "howto",
    "the screen the title's third item opened",
  );
  assertEqual(howto.menuIndex, 0, "the highlight on arriving at howto");

  // levelup and playing, entered from an overlay whose second offer was taken.
  isolate(h);
  const overlay = await openLevelUp(h, 2);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-ups opened",
  );
  assertGreaterThanOrEqual(
    overlay.run.offers.length,
    2,
    "offers the first overlay presents",
  );
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "the overlay's highlight before Enter");
  const next = await tap(h, "Enter");
  assertEqual(
    next.screen,
    "levelup",
    "the screen the queued level-up opened next",
  );
  assertEqual(
    next.menuIndex,
    0,
    "the highlight on arriving at the next overlay",
  );

  assertGreaterThanOrEqual(
    next.run.offers.length,
    2,
    "offers the next overlay presents",
  );
  const movedAgain = await tap(h, "ArrowDown");
  assertEqual(
    movedAgain.menuIndex,
    1,
    "the next overlay's highlight before Enter",
  );
  const playing = await tap(h, "Enter");
  assertEqual(
    playing.screen,
    "playing",
    "the screen the last acceptance returned to",
  );
  assertEqual(playing.menuIndex, 0, "the highlight on arriving at playing");

  // paused, entered from playing by the pause key.
  isolate(h);
  const paused = await tap(h, "KeyP");
  assertEqual(paused.screen, "paused", "the screen KeyP opened");
  assertEqual(paused.menuIndex, 0, "the highlight on arriving at paused");

  // chest, entered by the tick that collects one.
  isolate(h);
  const chest = await openChest(h);
  assertEqual(chest.screen, "chest", "the screen the collected chest opened");
  assertEqual(chest.menuIndex, 0, "the highlight on arriving at chest");

  // fallen, entered by the tick that takes hp to 0 or below.
  isolate(h);
  h.debug.setHp(0);
  const fallen = await h.tick(1);
  assertEqual(
    fallen.screen,
    "fallen",
    "the screen the ending tick left the run on",
  );
  assertEqual(fallen.menuIndex, 0, "the highlight on arriving at fallen");

  // title, entered from the end screen's second item.
  const onEnd = await tap(h, "ArrowDown");
  assertEqual(
    onEnd.menuIndex,
    END_ITEMS.length - 1,
    "the end menu's highlight before Enter",
  );
  const title = await tap(h, "Enter");
  assertEqual(
    title.screen,
    "title",
    "the screen the end menu's second item opened",
  );
  assertEqual(
    title.menuIndex,
    TITLE_ITEMS.indexOf("LIGHT THE LAMP"),
    "the entry selected on arriving at the title from an end screen",
  );

  // dawn, entered by the tick that crosses into DAWN_TIME.
  isolate(h);
  h.debug.setTick(DAWN_TICK - 1);
  const dawn = await h.tick(1);
  captureStill(h, "reset");
  assertEqual(
    dawn.screen,
    "dawn",
    "the screen the tick that reached dawn left",
  );
  assertEqual(dawn.menuIndex, 0, "the highlight on arriving at dawn");
});
