// hud/level-label-drawn — the experience bar carries the level, labelled.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Experience | A
// bar whose filled width scales with `xp / xpToNext`, labeled with `LEVEL_LABEL`
// (`LEVEL`) and the current level, as `LEVEL 4`." This point is about the LABEL;
// the bar is `hud/experience-bar-scales`.
//
// THE FIGURE, AND WHY IT IS 4. It is the figure the spec sentence itself gives,
// and it is a level a run reaches. On the isolated run this point poses, `4` is
// the level and nothing else: the experience is `0`, the health reads `100` of
// `100`, the kill count is `0`, and the clock reads `0:00`, so a `4` on the HUD
// came from the level.
//
// HOW THE LABEL IS READ. `specs/ui.md` fixes no font and no layout, and `as
// LEVEL 4` fixes only that the word and the figure are read together, so
// `hud/readouts` groups the runs a frame laid down into the LINES they landed on
// and this point asks for a line carrying both `LEVEL_LABEL` and `4` as a figure
// of its own. A build that draws the whole label in one call, one that draws the
// word and the number separately, and one that draws it glyph by glyph all
// answer the same; a build that draws a bar with no label, or a label with no
// level, does not.

import { afterEach, beforeEach, it } from "vitest";
import { LEVEL_LABEL } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { labelled } from "./readouts";

/** The level posed, the figure the spec sentence states the label with. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("labels the experience bar with the level", async () => {
  isolate(h, { level: LEVEL });

  const calls = await h.frameCalls();
  captureStill(h, "label");

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertEqual(posed.run.level, LEVEL, "the level the run holds");

  assertTrue(
    labelled(calls, LEVEL_LABEL, LEVEL),
    `a line of the HUD carrying ${LEVEL_LABEL} and the level ${LEVEL}`,
  );
});
