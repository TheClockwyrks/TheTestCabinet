// controls/menu-down — the down binding moves a menu's highlight down one item.
//
// specs/controls.md gives the `down` action a second effect beside the cursor —
// "moves a menu highlight down" — and specs/ui.md states the rule it obeys:
// "Every menu is vertical and is driven by `up`, `down`, and `confirm`. `up` and
// `down` move the highlight by one item and wrap at both ends". So: pose a menu
// with its highlight on a known item, press the down binding once, and read
// `menuIndex`.
//
// WHICH MENU, AND WHY NOT THE TITLE'S. The menu is the pause menu, whose
// `PAUSE_ITEMS` specs/ui.md fixes at THREE items. It has to be a three-item menu
// for this point to decide anything: a menu of two items is a two-cycle under
// the wrap rule, so on it "down" and "up" are the SAME permutation and a build
// that bound the two the wrong way round would pass both this point and
// controls/menu-up. The three-item menu separates them — see the readings below.
//
// AND THE HIGHLIGHT STARTS ON THE FIRST ITEM, so every wrong model reads a
// different number and a failure names which one the build implemented: down
// reads `1`, up reads `2` by the wrap, a key that moved nothing reads `0`, and a
// jump to the end of the menu reads `2`.
//
// WHAT THIS DOES NOT DECIDE. What happens at the ENDS of a menu, which is
// screens/title-menu-wraps-down's and screens/title-menu-wraps-up's — which is
// why the highlight is posed where a single press cannot reach a wrap — what the
// pause menu SHOWS, which is screens/pause-screen's, and what `confirm` then
// does with the highlighted item, which is controls/confirm-enter's.
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames.
// specs/controls.md reads the movement actions as HOLDS during play, and leaves
// how a menu samples them to the build, so a build that reads the press edge and
// one that reads the held value are both conforming. One frame with the key down
// arms the edge AND raises the value for exactly one frame, so both move the
// highlight by exactly one item.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt and shuts the three world gates before the screen is posed, so nothing
// behind the menu can move the screen out from under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The first key specs/controls.md binds the `down` action to. */
const KEY = "ArrowDown";

/** Frames the key is down: one, which is one press. */
const PRESS_TICKS = 1;

/**
 * Frames between the press and the reading.
 *
 * A beat, not a measurement: `holdFor` runs the frame that delivers the key, and
 * these follow it so a build that moves the highlight at the top of the next
 * frame reads the same as one that moves it in the frame the key arrived on.
 * Nothing advances on `paused` (specs/ui.md), so the highlight stays where the
 * press left it however many of these run.
 */
const BEAT_TICKS = 4;

/** Frames held on the menu, so the still is drawn from a settled frame. */
const SETTLE_TICKS = 20;

/**
 * The item the highlight starts on: the FIRST, `RESUME`.
 *
 * A single press down from here lands on the second item without touching
 * either end of the menu, so the wrap — screens/title-menu-wraps-down's point —
 * plays no part in this reading.
 */
const START_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the menu highlight down one item on the down binding", async () => {
  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(START_INDEX);

  const before = h.snapshot();
  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const pressed = h.snapshot();
  await h.advance(SETTLE_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of
  // the menu the key was pressed on.
  captureStill(h, "selection");

  assertEqual(
    before.menuIndex,
    START_INDEX,
    `the highlight rests on item ${START_INDEX} of the ${PAUSE_ITEMS.length}` +
      `-item pause menu before the key, which is what the reading below is ` +
      `measured from`,
  );
  assertEqual(
    pressed.menuIndex,
    START_INDEX + 1,
    `the highlighted item after one press of ${KEY} on a menu of ` +
      `${PAUSE_ITEMS.length} items: the down binding moves the highlight by ` +
      `one item (specs/controls.md, specs/ui.md)`,
  );
  assertEqual(
    pressed.screen,
    "paused",
    "the game is still on the menu the key was pressed on, so the reading " +
      "above is that menu's highlight",
  );
});
