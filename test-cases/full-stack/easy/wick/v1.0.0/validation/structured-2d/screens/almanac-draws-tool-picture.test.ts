// Wick — screens/almanac-draws-tool-picture: the `TOOLS` tab pictures the
// highlighted weapon with its produced icon and its produced effect.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", gives
// the entry's Picture as "The produced sprite the table below names", and the
// table gives `TOOLS` "the weapon's icon and its effect, animated where the
// effect is a sheet". `specs/assets.md` fixes one path per icon
// (`assets/icons/<id>.png`) and one file per single-frame effect, which this
// suite spells as `ICON_PATHS` and `EFFECT_SPRITES`; Taper's effect is one
// sprite rather than a sheet, so exactly one file carries it.
//
// WHAT IS READ. Which produced FILE the frame blitted, off the bytes the
// harness served the loader — so a build that drew a shape of its own where
// the picture belongs, or reached for a file it never produced, fails. Where
// the picture sits and how large it is drawn are the build's (`specs/ui.md`,
// Presentation), so no position is read.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it on the first tab with "`menuIndex` `0`"
// (`specs/instrumentation.md`), so the entry shown is Taper. Nothing is
// pressed, and no run is arranged: the almanac holds the idle run, which
// carries no weapon at all, so neither file can have come from a HUD slot.
//
// THE TOLERANCE. None: a produced file either was blitted or was not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { EFFECT_SPRITES, ICON_PATHS, effectPath } from "../constants";
import {
  blitsFrom,
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

/** The entry shown: the first of the tools tab, Taper. */
const ENTRY = "taper";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("blits Taper's produced icon and its produced slash effect", async () => {
  assertEqual(
    EFFECT_SPRITES[ENTRY].frames,
    1,
    "frames of Taper's effect, one sprite rather than a sheet (specs/assets.md)",
  );

  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.almanacTab, 0, "the tab the almanac opens on");
  assertEqual(posed.menuIndex, 0, "the entry the detail pane shows");
  assertLength(posed.run.weapons, 0, "the weapons held on the almanac");

  const { blits } = await h.frameDraw();
  captureStill(h, "picture");

  assertGreaterThanOrEqual(
    blitsFrom(blits, ICON_PATHS[ENTRY]).length,
    1,
    `blits of ${ICON_PATHS[ENTRY]}, the entry's produced icon (specs/ui.md, almanac)`,
  );
  assertGreaterThanOrEqual(
    blitsFrom(blits, effectPath(ENTRY)).length,
    1,
    `blits of ${effectPath(ENTRY)}, the entry's produced effect (specs/ui.md, almanac)`,
  );
});
