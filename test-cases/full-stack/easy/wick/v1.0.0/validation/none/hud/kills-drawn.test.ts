// hud/kills-drawn — the kill count is drawn on the HUD.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Kills | The kill
// count".
//
// THE FIGURE, AND WHY IT IS 143. `setKills` "Sets `kills` to `kills`, a whole
// number of at least `0`", and nothing else on this night shows `143`: the health
// is `100` of `100`, the clock `0:02`, the level the harness's, the next level
// `495` experience away, and no slot is filled. The count is read at `0` as well
// as at `143`, and `143` must be absent from the frame at `0`, because a readout
// that draws the figure whatever the state is not the kill count.
//
// HOW A FIGURE IS READ. `specs/ui.md` fixes no font, no layout, and no copy, so
// the runs of text the frame drew are grouped into the lines they landed on and
// the words their spacing makes, and a figure is a maximal run of digits in some
// word: a readout of `143`, one of `143 KILLS`, and one drawn glyph by glyph all
// answer, and one reading `1143` does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnWords, drewFigure } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

/** The kill count posed: a figure no other readout on this night carries. */
const KILLS = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the kill count the run holds", async () => {
  await poseNight(h);

  await h.debug.setKills(0);
  const none = await drawnCalls(h);
  await h.debug.setKills(KILLS);
  const many = await drawnCalls(h);
  await captureStill(h, "kills");

  const posed = await h.snapshot();
  assertEqual(posed.run.kills, KILLS, "the kill count posed");
  assertTrue(
    drewFigure(many, KILLS),
    `${KILLS} drawn on the HUD at ${KILLS} kills (the words drawn were ${JSON.stringify(
      drawnWords(many),
    )})`,
  );
  assertTrue(
    !drewFigure(none, KILLS),
    `no ${KILLS} on the HUD at 0 kills (the words drawn were ${JSON.stringify(
      drawnWords(none),
    )})`,
  );
});
