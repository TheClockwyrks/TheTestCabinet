// screens/almanac-draws-tool-picture — the TOOLS tab pictures its highlighted
// weapon.
//
// WHAT THIS DECIDES. One thing: the frame of the tools tab with its first entry
// highlighted paints that weapon's two produced files, its icon and its effect,
// rather than a shape of the build's own or another item's picture. The name,
// the figures and the line beside the picture are
// `almanac-shows-tool-detail`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the parts table): "Picture | The produced sprite
//   the table below names, animated where that sprite is a sheet."
//   specs/ui.md (`almanac`, the picture-and-stats table): "`TOOLS` | the
//   weapon's icon and its effect, animated where the effect is a sheet".
//   specs/assets.md ("The icons"): "Each is one `24 x 24` sprite at
//   `assets/icons/<id>.png`, for each id in `BASE_WEAPON_IDS`,
//   `EVOLUTION_IDS`, and `PASSIVE_IDS`".
//   specs/assets.md ("The weapon effects"): Taper's row, the single sprite
//   `assets/sprites/effects/taper.png`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which opens on the
// tools tab with `menuIndex` `0`, and one frame. The entry read is the first of
// `BASE_WEAPON_IDS`, whose effect is one sprite rather than a sheet, so the
// file the picture must paint is a single path.
//
// THE TOLERANCE. None on identity: a blit either painted the produced file for
// that id or it did not. Nothing about where either picture sits or how large
// it is drawn is read, since specs/ui.md fixes the almanac no layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_WEAPON_IDS,
  effectFramePath,
  iconPath,
  WEAPON_NAMES,
} from "../constants";
import {
  blitsOfFile,
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

/** The tools tab's first entry, and the two produced files its picture paints. */
const TOOL = BASE_WEAPON_IDS[0];
const FILES = [iconPath(TOOL), effectFramePath(TOOL)];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("paints the weapon's produced icon and its produced effect", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");
  assertEqual(posed.almanacTab, 0, "the tab the entry is read on");
  assertEqual(posed.menuIndex, 0, "the entry the picture is read for");

  const { blits } = await h.frameDraw();
  captureStill(h, "picture");

  assertDeepEqual(
    FILES.filter((file) => blitsOfFile(blits, file).length === 0),
    [],
    `the produced files of ${WEAPON_NAMES[TOOL]}'s picture the almanac never painted`,
  );
});
