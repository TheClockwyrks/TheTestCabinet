// Wick — screens/chest-copy: the chest overlay draws its heading over the
// world it froze.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`": "An
// overlay over the held world, opened as `specs/progression.md` states. It
// shows `CHEST_TEXT` (`A CHEST OPENS`) and the result in `chestResult`."
// `specs/ui.md`, "What advances on each screen", gives `chest` "Nothing. The
// world beneath holds exactly the tick it was at."
//
// WHAT IS READ. Two things the frame did: it drew the heading, and it drew the
// world beneath, read as the posed moth's produced sprite landing where the
// camera puts its world point — the topmost blit there, since the
// specification fixes what is drawn where and not how many calls paint it.
// Which result the overlay shows has three
// points of its own; palette, font, and layout are the build's
// (`specs/ui.md`, Presentation).
//
// THE DRIVE. An isolated `playing` world holding one moth 200 units to the
// right and 100 down and nothing else, with every driver switch off; a chest
// pickup posed at the lamplighter's own centre and the one tick that collects
// it, which `specs/progression.md` says ends on the `chest` screen. That is
// the real collection path `specs/instrumentation.md` names as the only way
// to the overlay.
//
// THE TOLERANCE. The heading is exact as a substring; the sprite's centre is
// matched within `SPRITE_TOL` device pixels of its world point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { CHEST_TEXT } from "../constants";
import {
  blitNear,
  captureStill,
  createHarness,
  isolate,
  openChest,
  placeEnemy,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

const MOTH_X = 200;
const MOTH_Y = 100;
/** How far a blit's centre may sit from the enemy's world point, in device pixels. */
const SPRITE_TOL = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws A CHEST OPENS over the held world", async () => {
  isolate(h);
  placeEnemy(h, "moth", MOTH_X, MOTH_Y);

  const overlay = await openChest(h);
  const { calls, blits } = await h.frameDraw();
  captureStill(h, "chest");

  assertEqual(overlay.screen, "chest", "the screen the frame is read on");
  assertTrue(
    drewText(calls, CHEST_TEXT),
    `the overlay drew ${CHEST_TEXT} (specs/ui.md, chest)`,
  );
  assertNotNull(
    blitNear(h, blits, MOTH_X, MOTH_Y, SPRITE_TOL),
    "the moth's sprite drawn beneath the overlay",
  );
});
