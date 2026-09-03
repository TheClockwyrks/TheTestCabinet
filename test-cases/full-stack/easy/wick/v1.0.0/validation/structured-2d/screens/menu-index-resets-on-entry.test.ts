// Wick — screens/menu-index-resets-on-entry: arriving on any screen puts the
// highlight back on the first item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "Menu navigation":
// "`menuIndex` is `0` on entering every screen, and on a screen with no menu
// it stays `0`." `specs/state.md` says the same of the field, and each
// screen's own section repeats it: `title`, `almanac`, `levelup`, `paused`,
// and the end screens all arrive on `0`, `THE ALMANAC` sets "`menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", `HOW TO PLAY` "Sets
// `screen = howto` and `menuIndex = 0`", and `MAIN MENU` and `TITLE` return to
// `title` "with `menuIndex = 0`".
//
// THE DRIVE. Every one of the nine screens is entered once, by the route the
// specification gives it, and the arrival is read. Five of those routes start
// from a screen whose highlight was moved off `0` first, which is what makes
// the point bite: `almanac` is entered from a title standing on its second
// item and `howto` from a title standing on its third, the two items
// `TITLE_ITEMS` lists after `LIGHT THE LAMP`; the second `levelup` overlay and
// the return to `playing` are entered by accepting the SECOND offer of an
// overlay with two level-ups queued (`specs/progression.md`: "When level-ups
// remain queued the next overlay opens immediately"); and `title` is entered
// by confirming `TITLE` on a fallen screen standing on its second item. The
// other three screens have no highlight to leave off `0`: `chest` is reached
// through a chest posed at the lamplighter's centre and the tick that collects
// it, `paused` through a real `KeyP`, and the two endings through the ending
// rule of `specs/world.md`.
//
// Each `playing` scenario is an isolated world with every driver switch off,
// so nothing autonomous opens a screen the drive did not ask for.
//
// THE TOLERANCE. None: a screen name and an index, read on each arrival.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  openChest,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

/** How many level-ups the overlay scenario queues: one to leave, one to take. */
const QUEUED = 2;

/** Where `THE ALMANAC` and `HOW TO PLAY` stand in `TITLE_ITEMS` (specs/ui.md). */
const THE_ALMANAC = TITLE_ITEMS.indexOf("THE ALMANAC");
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Stand on the title item at `index`, from a title freshly reset onto `0`. */
async function standOnTitleItem(
  harness: Harness,
  index: number,
): Promise<void> {
  harness.reset();
  let state = harness.snapshot();
  for (let press = 0; press < index; press += 1) {
    state = await tap(harness, "ArrowDown");
  }
  assertEqual(
    state.menuIndex,
    index,
    `the title's highlight before confirming ${TITLE_ITEMS[index]}`,
  );
}

it("arrives on every screen with menuIndex 0", async () => {
  await standOnTitleItem(h, THE_ALMANAC);
  const almanac = await tap(h, "Enter");
  assertEqual(almanac.screen, "almanac", "the screen THE ALMANAC entered");
  assertEqual(almanac.menuIndex, 0, "menuIndex on arriving at almanac");

  await standOnTitleItem(h, HOW_TO_PLAY);
  const howto = await tap(h, "Enter");
  assertEqual(howto.screen, "howto", "the screen HOW TO PLAY entered");
  assertEqual(howto.menuIndex, 0, "menuIndex on arriving at howto");

  isolate(h);
  const first = await openLevelUp(h, QUEUED);
  assertEqual(first.screen, "levelup", "the screen the opening tick entered");
  assertEqual(first.menuIndex, 0, "menuIndex on arriving at the first overlay");

  const onSecond = await tap(h, "ArrowDown");
  assertEqual(
    onSecond.menuIndex,
    1,
    "the overlay's highlight before accepting",
  );
  const next = await tap(h, "Enter");
  assertEqual(next.screen, "levelup", "the screen the acceptance entered");
  assertEqual(next.menuIndex, 0, "menuIndex on arriving at the queued overlay");

  const onSecondAgain = await tap(h, "ArrowDown");
  assertEqual(
    onSecondAgain.menuIndex,
    1,
    "the overlay's highlight before accepting",
  );
  const playing = await tap(h, "Enter");
  assertEqual(
    playing.screen,
    "playing",
    "the screen the last acceptance entered",
  );
  assertEqual(playing.menuIndex, 0, "menuIndex on arriving back at playing");

  isolate(h);
  const chest = await openChest(h);
  assertEqual(chest.screen, "chest", "the screen the collected chest entered");
  assertEqual(chest.menuIndex, 0, "menuIndex on arriving at the chest overlay");

  isolate(h);
  const paused = await tap(h, "KeyP");
  assertEqual(paused.screen, "paused", "the screen KeyP entered");
  assertEqual(paused.menuIndex, 0, "menuIndex on arriving at the pause screen");

  isolate(h);
  const fallen = await endFallen(h);
  assertEqual(fallen.screen, "fallen", "the screen the ending tick entered");
  assertEqual(
    fallen.menuIndex,
    0,
    "menuIndex on arriving at the fallen screen",
  );

  const onTitleItem = await tap(h, "ArrowDown");
  assertEqual(
    onTitleItem.menuIndex,
    1,
    "the fallen screen's highlight before TITLE",
  );
  const title = await tap(h, "Enter");
  assertEqual(title.screen, "title", "the screen TITLE entered");
  assertEqual(title.menuIndex, 0, "menuIndex on arriving at the title screen");

  isolate(h);
  const dawn = await endDawn(h);
  captureStill(h, "reset");
  assertEqual(dawn.screen, "dawn", "the screen the dawn tick entered");
  assertEqual(dawn.menuIndex, 0, "menuIndex on arriving at the dawn screen");
});
