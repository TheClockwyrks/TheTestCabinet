// Wick — screens/levelup-copy: the level-up overlay draws its heading over the
// world it froze.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`": "An
// overlay over the world, which stays drawn beneath it exactly as the tick
// that opened the overlay left it. It shows `LEVEL_UP_TEXT`
// (`THE LAMP BURNS BRIGHTER`) and the offers in `offers`".
//
// WHAT IS READ. Two things the frame did: it drew the heading, and it drew the
// world beneath, read as the posed moth's produced sprite landing where the
// camera puts its world point — the topmost blit there, since the
// specification fixes what is drawn where and not how many calls paint it.
// The offers are `screens/levelup-lists-offers`'s
// point; palette, font, and layout are the build's (`specs/ui.md`,
// Presentation).
//
// THE DRIVE. An isolated `playing` world holding one moth 200 units to the
// right and 100 down and nothing else, with every driver switch off; one
// level-up posed pending and the one `playing` tick that
// `specs/progression.md` says opens the overlay at its end.
//
// THE TOLERANCE. The heading is exact as a substring; the sprite's centre is
// matched within `SPRITE_TOL` device pixels of its world point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { LEVEL_UP_TEXT } from "../constants";
import {
  blitNear,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
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

it("draws THE LAMP BURNS BRIGHTER over the held world", async () => {
  isolate(h);
  placeEnemy(h, "moth", MOTH_X, MOTH_Y);

  const overlay = await openLevelUp(h, 1);
  const { calls, blits } = await h.frameDraw();
  captureStill(h, "overlay");

  assertEqual(overlay.screen, "levelup", "the screen the frame is read on");
  assertTrue(
    drewText(calls, LEVEL_UP_TEXT),
    `the overlay drew ${LEVEL_UP_TEXT} (specs/ui.md, levelup)`,
  );
  assertNotNull(
    blitNear(h, blits, MOTH_X, MOTH_Y, SPRITE_TOL),
    "the moth's sprite drawn beneath the overlay",
  );
});
