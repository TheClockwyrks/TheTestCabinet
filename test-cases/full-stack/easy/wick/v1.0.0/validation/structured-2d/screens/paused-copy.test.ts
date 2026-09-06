// Wick — screens/paused-copy: the pause screen draws `PAUSED` with its menu
// beneath it and the HUD over the world it froze.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`": "The
// world held still, with the HUD, under `PAUSED_TEXT` (`PAUSED`), and the menu
// `PAUSE_ITEMS` below it". `specs/ui.md`, "What advances on each screen",
// gives `paused` "Nothing. The world beneath holds exactly the tick it was
// at." The HUD's own table names `LEVEL_LABEL` (`LEVEL`) beside the level and
// "The run clock as `m:ss`", the two readouts read here as evidence the HUD is
// drawn at all.
//
// WHAT IS READ, AND WHY. Four things the frame did: it drew `PAUSED`; it drew
// the pause menu BELOW that heading, read as the highest anchor of either of
// `PAUSE_ITEMS` sitting lower on the stage than `PAUSED`'s; it drew the HUD,
// read as the two of its readouts that are TEXT the specification fixes the
// form of; and it drew the world beneath, read as the posed moth's own
// produced sprite landing at the same device pixel it landed on the `playing`
// frame before the pause. Palette, font, and layout are the build's
// (`specs/ui.md`, Presentation), so nothing about how any of it looks is read,
// and which of the two items is listed first is
// `screens/paused-lists-items`'s point.
//
// THE DRIVE. An isolated `playing` world holding one moth 200 units to the
// right and 100 down, the clock posed so `m:ss` reads something other than the
// zero every screen would show. One frame on `playing` gives the sprite's
// place; the pause posed through `setScreen("paused")` — which
// `specs/instrumentation.md` says enters it by setting `screen` alone, with the
// run left as it stands — and one frame give the paused picture. The key that
// pauses is `screens/pause-via-key`'s point, so nothing is pressed here.
//
// THE TOLERANCE. The copy is exact as a substring; the sprite's centre is
// matched within `SPRITE_TOL` device pixels, the slack that lets a build round
// its blit differently between two frames without the world having moved. The
// stacking is strict: the heading's anchor is ABOVE both items' anchors, with
// no slack, since a menu drawn at the heading's own height is not below it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertNotNull,
  assertPointNear,
  assertTrue,
} from "../assert";
import { LEVEL_LABEL, PAUSED_TEXT, PAUSE_ITEMS, clockText } from "../constants";
import {
  blitCenter,
  blitsNear,
  captureStill,
  createHarness,
  drewText,
  isolate,
  placeEnemy,
  poseScreen,
  placedRuns,
  type Harness,
} from "../harness";
import { anchorY } from "./stage";

/** Where the moth stands, relative to the lamplighter at the origin. */
const MOTH_X = 200;
const MOTH_Y = 100;
/** How far a blit's centre may sit from the enemy's world point, in device pixels. */
const SPRITE_TOL = 24;
/** The clock the run is paused at. */
const TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws PAUSED, the pause menu beneath it, and the HUD over the frozen world", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  placeEnemy(h, "moth", MOTH_X, MOTH_Y);

  const playing = await h.frameDraw();
  const onPlaying = blitsNear(h, playing.blits, MOTH_X, MOTH_Y, SPRITE_TOL);
  assertLength(onPlaying, 1, "the moth's sprite on the playing frame");

  const after = poseScreen(h, "paused");
  const paused = await h.frameDraw();
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen the frame is read on");
  assertTrue(
    drewText(paused.calls, PAUSED_TEXT),
    `the pause screen drew ${PAUSED_TEXT} (specs/ui.md, paused)`,
  );
  assertTrue(
    drewText(paused.calls, LEVEL_LABEL),
    `the pause screen drew the HUD's ${LEVEL_LABEL} readout (specs/ui.md, playing)`,
  );
  assertTrue(
    drewText(paused.calls, clockText(TICK)),
    `the pause screen drew the HUD's clock, ${clockText(TICK)} (specs/ui.md, playing)`,
  );

  const draws = placedRuns(paused.calls);
  const heading = anchorY(draws, PAUSED_TEXT);
  assertNotNull(heading, `where ${PAUSED_TEXT} was drawn`);
  for (const item of PAUSE_ITEMS) {
    const menu = anchorY(draws, item);
    assertNotNull(menu, `where the pause menu's ${item} was drawn`);
    assertLessThan(
      heading as number,
      menu as number,
      `${PAUSED_TEXT} drawn above ${item}, in device pixels down the stage`,
    );
  }

  const onPaused = blitsNear(h, paused.blits, MOTH_X, MOTH_Y, SPRITE_TOL);
  assertLength(onPaused, 1, "the moth's sprite on the paused frame");
  assertEqual(
    onPaused[0].id,
    onPlaying[0].id,
    "the produced file the moth was drawn from while paused",
  );
  assertPointNear(
    blitCenter(onPaused[0]),
    blitCenter(onPlaying[0]),
    SPRITE_TOL,
    "where the moth was drawn while paused, against where it was drawn playing",
  );
});
