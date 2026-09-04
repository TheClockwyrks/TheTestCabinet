// pointer/stage — what the Pointer checks share: the point a gesture aims at,
// the screens each gesture is posed on, and the cue one frame raised.
// CASE-PROVIDED.
//
// No review item names this file. Every function here is either a compound
// sequence of the surface's atomic operations or a reading over what the
// surface reports, which the authoring guide has live beside the checks rather
// than inside any one of them.
//
// WHERE A GESTURE AIMS. `specs/controls.md` ("The pointer"): "Each item the menu
// currently shows occupies a rectangle on the stage, and no two of a screen's
// rectangles overlap", and `specs/instrumentation.md` ("Menus") has `menuRects`
// report those rectangles "in stage coordinates, `0` to `STAGE_W` across and `0`
// to `STAGE_H` down, which are the coordinates the pointer is read in ... Each
// rectangle is the area a hover or a click selects that item inside". The
// specification fixes no layout at all, so WHERE a build draws its menu is the
// build's: a check reads the rectangle back and aims at the middle of it, which
// is a point inside it whatever shape it is. Every point every check here uses
// is derived that way, bar the one that must be inside NO rectangle, which
// `pointerRest` sweeps the stage for.
//
// WHY THE COUNT IS ASSERTED FIRST. A rectangle is only "the second title item's"
// because `menuRects` reports "one rectangle per item of the menu they show", in
// menu order. A check that aimed at `rects[1]` of a list of the wrong length
// would be aiming at something else, so the count is read as the check's
// precondition and a build that reports the wrong number fails there, on the
// instrumentation rule it broke, rather than on the pointer rule it may keep.
//
// HOW EACH SCREEN IS POSED. Through the routes `specs/instrumentation.md` gives
// `setScreen`: `almanac` "exactly as confirming `THE ALMANAC` does", `paused`
// from `playing` "exactly as `pause` does", and the endings "exactly as that
// ending does". Where a check is about what a gesture leaves of a RUN, the run
// is posed on an isolated night first, because "the run exactly as the pause
// left it" is only visible against a run that has something in it.

import { assertEqual } from "../assert";
import { ALMANAC_TABS, type OfferId, type ScreenName } from "../constants";
import {
  centerOf,
  cuesNamed,
  cuesOnFrame,
  isolate,
  menuRects,
  openLevelUp,
  pressDown,
  tabRects,
  type Harness,
  type NamedCue,
  type WickSnapshot,
  type XY,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a gesture aims                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The middle of each rectangle `menuRects` reports for the current screen, in
 * menu order, once the list is the `expected` length the screen's menu has.
 *
 * The count is the check's precondition rather than its claim: what `menuRects`
 * reports is decided under Instrumentation, and a pointer check reads it only so
 * that the rectangle it aims into is the item it means.
 */
export async function menuPoints(
  h: Harness,
  expected: number,
  what: string,
): Promise<XY[]> {
  const rects = await menuRects(h);
  assertEqual(
    rects.length,
    expected,
    `the rectangles menuRects reports ${what}`,
  );
  return rects.map(centerOf);
}

/**
 * The middle of each rectangle `tabRects` reports, in `ALMANAC_TABS` order.
 *
 * "Reports the rectangles of the almanac's tab bar on `almanac`, one per tab in
 * `ALMANAC_TABS` order" (specs/instrumentation.md — "Menus").
 */
export async function tabPoints(h: Harness, what: string): Promise<XY[]> {
  const rects = await tabRects(h);
  assertEqual(
    rects.length,
    ALMANAC_TABS.length,
    `the rectangles tabRects reports ${what}`,
  );
  return rects.map(centerOf);
}

/* -------------------------------------------------------------------------- */
/* What a gesture left                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The game stands on `screen` with the highlight at `index`, or the point fails.
 *
 * The reading every hover point makes: the gesture moved the highlight and left
 * the screen where it found it.
 */
export function assertHighlight(
  after: WickSnapshot,
  screen: ScreenName,
  index: number,
  what: string,
): void {
  assertEqual(after.screen, screen, `the screen ${what}`);
  assertEqual(after.menuIndex, index, `menuIndex ${what}`);
}

/** How many times the cue `name` sounded on `frame`. */
export function heard(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
): number {
  return cuesNamed(cuesOnFrame(cues, frame), name).length;
}

/**
 * The cue `name` sounded on `frame` exactly once.
 *
 * specs/ui.md ("Audio"): each cue is played "at most once on that tick", and
 * "on the frame for a menu event".
 */
export function assertHeardOnce(
  cues: readonly NamedCue[],
  frame: number,
  name: string,
  what: string,
): void {
  assertEqual(heard(cues, frame, name), 1, what);
}

/* -------------------------------------------------------------------------- */
/* Posing a screen                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Frames run after a screen is posed, before a check watches anything.
 *
 * Two: one for the two looping cues to be "reconciled from the state by the next
 * frame" (specs/instrumentation.md), and one more so a build that reconciles at
 * the end of its frame rather than at the start has had a whole frame either
 * way. It keeps a loop's own start off the frame a cue check reads, and decides
 * nothing.
 */
export const SETTLE_FRAMES = 2;

/** An isolated night standing on `playing` with nothing alive and nothing held. */
export async function night(h: Harness): Promise<WickSnapshot> {
  const posed = await isolate(h);
  assertEqual(
    posed.screen,
    "playing",
    "the screen an isolated night stands on",
  );
  return posed;
}

/**
 * Stand on the title as the game opens on it, with the highlight at the top.
 *
 * `specs/ui.md` ("`title`"): "The game opens here, and the debug surface's
 * `reset` returns here", with "`menuIndex` is `0` on arriving".
 */
export async function poseTitle(h: Harness): Promise<WickSnapshot> {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the game opens on");
  assertEqual(title.menuIndex, 0, "menuIndex on the title the game opened on");
  return title;
}

/**
 * Enter the almanac the way `THE ALMANAC` does: "the idle run, `menuIndex` `0`,
 * `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md —
 * `setScreen`).
 */
export async function poseAlmanac(h: Harness): Promise<WickSnapshot> {
  await h.debug.setScreen("almanac");
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "almanac",
    'the screen setScreen("almanac") entered',
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at the almanac");
  assertEqual(opened.almanacTab, 0, "almanacTab on arriving at the almanac");
  assertEqual(
    opened.almanacScroll,
    0,
    "almanacScroll on arriving at the almanac",
  );
  return opened;
}

/**
 * Hold the running night under the pause screen: "`paused` | `playing` | Exactly
 * as `pause` does" (specs/instrumentation.md — `setScreen`), with "`menuIndex`
 * is `0` on arriving" (specs/ui.md — "`paused`").
 */
export async function posePaused(h: Harness): Promise<WickSnapshot> {
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "the screen the pause is posed from");
  await h.debug.setScreen("paused");
  const held = await h.snapshot();
  assertEqual(held.screen, "paused", "the screen the pause entered");
  assertEqual(held.menuIndex, 0, "menuIndex on arriving at paused");
  return held;
}

/**
 * End the isolated run fallen on the next tick, and read the end screen.
 *
 * `specs/world.md` ("Fallen and dawn") ends a run fallen when "`hp` is `0` or
 * below" at the end of a tick, which `setHp` reaches directly: "A value at or
 * below `0` ends the run fallen at the end of the next `playing` tick"
 * (specs/instrumentation.md).
 */
export async function endFallen(h: Harness): Promise<WickSnapshot> {
  await h.debug.setHp(0);
  const ended = await h.step(1);
  assertEqual(ended.screen, "fallen", "the screen a run out of health ends on");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at fallen");
  return ended;
}

/**
 * Open a level-up overlay presenting exactly `ids`, over an isolated night.
 *
 * `setNextOffers` "is checked against the candidate pool at the moment the next
 * level-up overlay opens ... and the overlay then presents exactly that list in
 * that order" (specs/instrumentation.md), and the overlay is opened by a tick
 * that ends with a level-up queued (specs/progression.md). The overlay
 * presenting the queued list is the PRECONDITION of a check about what the
 * pointer does with its rows: a build that presented something else fails the
 * progression points that decide the draw, rather than being read here against a
 * list the check did not pose.
 */
export async function openOffers(
  h: Harness,
  ids: readonly OfferId[],
  count = 1,
): Promise<WickSnapshot> {
  await h.debug.setNextOffers(ids);
  const opened = await openLevelUp(h, count);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    (opened.run.offers ?? []).join(","),
    ids.join(","),
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on opening the overlay");
  return opened;
}

/**
 * Move the almanac's entry highlight to `index` with real `down` presses, and
 * read back where it landed.
 *
 * The surface carries no pose for `menuIndex`, so the keyboard is the only way a
 * check reaches a highlight that is not the `0` a screen is entered on:
 * specs/controls.md gives `almanac` "`up`, `down` move the entry highlight,
 * wrapping". The landing is read back, so a build whose `down` is broken fails
 * on the precondition rather than on the gesture the check is about.
 *
 * The pointer is left where it has never been moved to, so nothing hovers while
 * the keys drive: the hover rule reads a pointer the page has yet to place.
 */
export async function highlightEntry(
  h: Harness,
  index: number,
): Promise<WickSnapshot> {
  let posed = await h.snapshot();
  for (let i = 0; i < index; i += 1) posed = await pressDown(h);
  assertEqual(posed.menuIndex, index, "the highlighted entry the keys reached");
  return posed;
}
