// presentation/paused-draws-world-and-hud — the pause screen draws the world
// and the HUD exactly as the last playing frame did.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("paused"): "The world held
// still, with the HUD, under PAUSED_TEXT (PAUSED)", and its screen table:
// "paused | The world held still under PAUSED_TEXT." The same file's table of
// what advances fixes that neither can move under the pause: on "levelup,
// chest, paused" advancing is "Nothing. The world beneath holds exactly the
// tick it was at." specs/world.md ("The camera and the view") fixes where a
// world position is drawn: "A world point (wx, wy) is drawn at the stage
// position (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)", and
// specs/assets.md ("The sprites") that each produced sprite "is drawn centered
// on the thing it depicts". specs/ui.md's HUD table gives what the HUD carries:
// the run clock, the level, the kills, and "WEAPON_SLOTS (6) slots in slot
// order, each held weapon as its icon", the passive slots the same way.
//
// THE WORLD. The isolated night `beneath.ts` poses: the lamplighter off the
// world origin, three enemies of three types standing around it inside the
// view, and every driver switch off, so nothing on the field moves, spawns,
// fires, or is hit either side of the transition. One weapon and one passive
// are held so the HUD has a filled slot of each kind to draw, and with
// `weaponFire` off the weapon never fires, so nothing it would create can
// appear between the two frames. The pause is posed through `setScreen`, which
// specs/instrumentation.md enters "exactly as the real transition into it
// enters it", so the point does not depend on the pause key another point
// decides.
//
// WHAT IS READ. One playing frame, then PAUSED_FRAMES frames drawn on
// `paused`. Of the world: the lamplighter's produced sprite and each enemy's
// own sheet, each centered on the stage point the camera formula gives its
// position in the state the last playing tick left. Of the HUD: the box each
// held item's produced icon was drawn at, and every run of text the playing
// frame drew, each of which the paused frame draws too. specs/ui.md "fixes no
// palette, no font, no layout, and no styling for any screen", so the HUD is
// read as the produced icons it placed and the copy it wrote rather than as the
// shapes a build chose to draw it with.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center and on each
// icon's box, the case's tolerance for a bitmap a build may snap to whole
// device pixels. The text is compared as a set the paused frame must still
// carry, since the pause adds PAUSED_TEXT to what the playing frame wrote.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDefined,
  assertEqual,
  assertWithin,
} from "../assert";
import { DRAWN_POINT_TOLERANCE, iconPath, type OfferId } from "../constants";
import {
  blitBoxOnStage,
  blitsOfFile,
  captureStill,
  createHarness,
  drawnText,
  holdPassive,
  holdWeapon,
  isolate,
  type Blit,
  type Harness,
} from "../harness";
import { assertWorldDrawn, poseWorld } from "./beneath";

/** The two items held, so the HUD has a filled slot of each kind to draw. */
const HELD_WEAPON = "taper";
const HELD_PASSIVE = "wick";

/** The two produced icons the HUD must place for them. */
const HELD_ICONS: readonly OfferId[] = [HELD_WEAPON, HELD_PASSIVE];

/** Frames drawn on the pause and read. */
const PAUSED_FRAMES = 3;

/** Where the produced icon `id` was drawn, in logical stage units. */
function iconBox(
  h: Harness,
  blits: readonly Blit[],
  id: OfferId,
): { x: number; y: number; w: number; h: number } {
  const drawn = blitsOfFile(blits, iconPath(id));
  const last = drawn[drawn.length - 1];
  assertDefined(last, `a drawImage of the produced icon ${iconPath(id)}`);
  return blitBoxOnStage(h, last as Blit);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the world and the HUD on the pause exactly as the last playing frame did", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the run is paused from");
  const stood = poseWorld(h);
  holdWeapon(h, HELD_WEAPON, 1);
  holdPassive(h, HELD_PASSIVE, 1);

  const playing = await h.frameBlits();
  const last = h.snapshot();
  assertEqual(last.screen, "playing", "the screen the last drawn frame ran on");
  const icons = HELD_ICONS.map((id) => ({
    id,
    box: iconBox(h, playing, id),
  }));
  const text = drawnText(h.lastCalls());

  h.debug.setScreen("paused");
  assertEqual(h.snapshot().screen, "paused", "the screen the pose left");

  for (let frame = 1; frame <= PAUSED_FRAMES; frame += 1) {
    const blits = await h.frameBlits();
    if (frame === 1) captureStill(h, "beneath");
    assertWorldDrawn(h, blits, last, stood, `paused frame ${frame}`);

    for (const icon of icons) {
      const box = iconBox(h, blits, icon.id);
      assertWithin(
        box.x,
        icon.box.x,
        DRAWN_POINT_TOLERANCE,
        `paused frame ${frame}: the ${icon.id} icon's left edge`,
      );
      assertWithin(
        box.y,
        icon.box.y,
        DRAWN_POINT_TOLERANCE,
        `paused frame ${frame}: the ${icon.id} icon's top edge`,
      );
      assertWithin(
        box.w,
        icon.box.w,
        DRAWN_POINT_TOLERANCE,
        `paused frame ${frame}: the ${icon.id} icon's drawn width`,
      );
      assertWithin(
        box.h,
        icon.box.h,
        DRAWN_POINT_TOLERANCE,
        `paused frame ${frame}: the ${icon.id} icon's drawn height`,
      );
    }

    const paused = drawnText(h.lastCalls());
    for (const run of text) {
      assertContains(
        paused,
        run,
        `paused frame ${frame}: the runs of text the HUD drew`,
      );
    }
  }
});
