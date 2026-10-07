// Floe — controls/held-menu-move-fires-once: a direction held down on a menu
// moves the highlight exactly one item.
//
// `specs/controls.md` reads the four movement actions as HELD on the `playing`
// screen and as PRESS EDGES everywhere else: "On every other screen they are read
// as press edges, so one press moves the highlight one item." A press is one
// press however long the key stays down, so a second of a held direction is one
// move and not eighty-eight.
//
// THIS IS THE EDGE CASE THE `playing` SCREEN'S OWN RULE CREATES. The same four
// keys auto-repeat a hop at `HOP_COOLDOWN` while the critter is crossing
// (`specs/hopping.md`), so a build that reads them the same way on every screen
// hands a player a menu whose highlight flies off the moment a key is touched.
// That build passes `controls.menu-down` — the first move is right — and fails
// here, which is the separation this point exists for.
//
// THE MENU IS THE PAUSE MENU AND THE START IS ITS FIRST ENTRY, so one move lands
// on the second and a repeat lands anywhere else: a build that repeated reads as
// an index this check names rather than merely as "not `1`". The list is three
// long and wraps, so a repeating build cannot land back on `1` by accident inside
// a second unless it repeated exactly three times.
//
// THE HOLD IS A WHOLE SECOND of game time, which is `HOP_COOLDOWN` (`0.12` s)
// eight times over: a build repeating at the hop cadence would have moved eight
// items in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The highlight the menu is posed with, and the one entry a press must reach. */
const POSED_INDEX = 0;
const EXPECTED_INDEX = 1;

/** The direction held down: `down`, whose one move is a step rather than a wrap. */
const HELD_KEY = BINDINGS.down[0];

/** How long the key is held, in seconds of game time. */
const HOLD_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the pause menu's highlight one item for a direction held a second", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(POSED_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the first of the three`,
  );

  await h.holdFor(HELD_KEY, ticksFor(HOLD_SECONDS));
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    EXPECTED_INDEX,
    `one move, to ${PAUSE_ITEMS[EXPECTED_INDEX]}: a menu reads a direction as a ` +
      `press edge, so ${HOLD_SECONDS} s of it is one press (specs/controls.md)`,
  );
  assertEqual(
    after.screen,
    "paused",
    "and the menu is still the one the highlight moved on",
  );
});
