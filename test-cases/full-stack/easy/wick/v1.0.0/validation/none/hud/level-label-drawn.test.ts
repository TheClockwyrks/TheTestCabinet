// hud/level-label-drawn — the experience bar is labeled with the level.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Experience | A
// bar whose filled width scales with `xp / xpToNext`, labeled with `LEVEL_LABEL`
// (`LEVEL`) and the current level, as `LEVEL 4`". This point decides the label;
// the bar's scaling is `hud/experience-bar-scales`.
//
// THE FIGURE, AND WHY IT IS 4. The level is posed at `4` through `setLevel`,
// which "Sets `level` to `level` ... `xp` is untouched". On the night this point
// poses, nothing else the HUD carries shows a `4` as a figure of its own: the
// health is `100` of `100`, the kills `0`, the clock `0:02`, the next level
// `35` experience away, and no slot is filled.
//
// HOW THE LABEL IS READ. `specs/ui.md` fixes no font and no layout, so the runs
// of text the frame drew are grouped into the lines they landed on, and the label
// is read as a line carrying the word `LEVEL_LABEL` and `4` as a maximal run of
// digits. A build that draws `LEVEL 4` in one call, one that draws the word and
// the figure separately, and one that lays each glyph down on its own all answer
// the same, and a line reading `LEVEL 40` does not.

import { afterEach, beforeEach, it } from "vitest";
import { LEVEL_LABEL } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnLines, labelled } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

/** The level posed: one no other readout on this night shows. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("labels the experience bar with the level in play", async () => {
  await poseNight(h);
  await h.debug.setLevel(LEVEL);

  const calls = await drawnCalls(h);
  await captureStill(h, "label");

  const posed = await h.snapshot();
  assertEqual(posed.run.level, LEVEL, "the level posed");
  assertTrue(
    labelled(calls, LEVEL_LABEL, LEVEL),
    `a line reading ${LEVEL_LABEL} ${LEVEL} on the HUD (the lines drawn were ${JSON.stringify(
      drawnLines(calls),
    )})`,
  );
});
