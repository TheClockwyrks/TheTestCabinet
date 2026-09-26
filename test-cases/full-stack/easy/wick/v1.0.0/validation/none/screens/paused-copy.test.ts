// screens/paused-copy — the pause screen draws PAUSED, the pause menu beneath
// it, and the HUD over the world the pause held.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "The world held
// still, with the HUD, under `PAUSED_TEXT` (`PAUSED`), and the menu
// `PAUSE_ITEMS` below it: `RESUME`, `MAIN MENU`, in that order." The HUD's
// readouts are
// specs/ui.md's `playing` table: the experience bar "labeled with `LEVEL_LABEL`
// (`LEVEL`) and the current level, as `LEVEL 4`", the clock "as `m:ss`,
// counting up from `0:00` in whole seconds, the seconds always two digits", and
// "Kills | The kill count." The world beneath is drawn where the camera puts
// it: "A world point `(wx, wy)` is drawn at the stage position
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`" (specs/world.md), and
// a sprite is "drawn centered on the thing it depicts" at one unit per pixel
// (specs/assets.md).
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated so that one moth is
// the only thing in the world, and the moth is placed on the lamplighter's row
// well outside contact: what "the world beneath, exactly as the pause left it"
// means is decidable only against a thing whose world position the check knows.
// The clock, the level and the kills are posed to figures no fresh run carries,
// so a HUD drawn from defaults fails. Every driver switch is off and the frame
// that pauses ticks nothing, so what the paused frame draws is the tick the
// pause held.
//
// WHAT THIS DELIBERATELY DOES NOT READ. The order the two menu items run in.
// That the names of `PAUSE_ITEMS` are on the frame at all, `RESUME` above
// `MAIN MENU`, is `paused-lists-items`; what is read here is the heading above
// the menu, which is the relation the `paused` row states of the heading.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`), the level and the kill count are matched as whole
// numbers standing alone rather than as digits inside another figure, and the
// moth's drawn center is within `BLIT_TOL` (`1` unit) of the
// camera's point, the case's allowance for a build that rounds a world position
// to the pixel grid before it blits. specs/ui.md ("Presentation") leaves the
// layout to the build, so the only arrangement asserted is the one the `paused`
// row states of the heading: `PAUSED` above each item of the menu below it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  BLIT_TOL,
  PAUSE_ITEMS,
  PAUSED_TEXT,
  clockText,
  enemySpriteSize,
  LEVEL_LABEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  drawNearest,
  mustEnemy,
  placeEnemy,
  pressPause,
  spriteDraws,
  stagePoint,
  type Harness,
} from "../harness";
import { assertNames, assertShows, assertStacked, night, shown } from "./stage";

/** Figures the HUD must read off the run rather than off a fresh one. */
const POSED = { tick: 4500, level: 7, kills: 250 };

/** Where the moth stands: on the lamplighter's row, far outside contact reach. */
const MOTH_X = 200;

const MOTH_SIZE = enemySpriteSize("moth");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws PAUSED above the menu, the HUD's figures, and the held moth", async () => {
  await night(h);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setKills(POSED.kills);
  const moth = await placeEnemy(h, "moth", MOTH_X, 0);

  const paused = await pressPause(h);
  assertEqual(paused.screen, "paused", "the screen the frame is read on");
  const page = await shown(h);
  await captureStill(h, "paused");

  assertShows(page, PAUSED_TEXT, "the pause screen");
  for (const item of PAUSE_ITEMS) {
    assertShows(page, item, "the pause screen's menu");
    assertStacked(page, PAUSED_TEXT, item, "the pause screen");
  }
  assertShows(page, clockText(POSED.tick), "the pause screen's clock");
  assertShows(page, `${LEVEL_LABEL} ${POSED.level}`, "the pause screen's HUD");
  assertNames(page, String(POSED.kills), "the pause screen's kill count");

  const at = mustEnemy(paused, moth.id);
  const where = stagePoint(paused, at.x, at.y);
  const drawn = drawNearest(spriteDraws(page.calls, MOTH_SIZE), where);
  assertNotNull(
    drawn ?? null,
    `a ${MOTH_SIZE.width} x ${MOTH_SIZE.height} image drawn on the paused frame, for the moth`,
  );
  assertNear(
    drawn!.cx,
    where.x,
    BLIT_TOL,
    "the moth's drawn center x under the pause",
  );
  assertNear(
    drawn!.cy,
    where.y,
    BLIT_TOL,
    "the moth's drawn center y under the pause",
  );
});
