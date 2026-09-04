// hud/kills-drawn — the HUD carries the kill count.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Kills | The kill
// count."
//
// THE FIGURES, AND WHY THEY ARE 0 AND 143. `0` is the count a run opens on
// (`specs/ui.md`, "A fresh run": "level `1` with `xp = 0` and `kills = 0`"), and
// `143` is a count a night reaches that no other readout on the HUD can be
// showing: on the isolated run this point poses the health reads `100` of `100`,
// the experience is `0`, the level is posed high, and the clock reads `0:00`.
// That is what makes the second frame decidable — a `143` on the HUD came from
// the kill count — and it is why the first frame is also read for the ABSENCE of
// `143`, so a HUD that draws a fixed figure rather than the count fails here.
//
// HOW A FIGURE IS READ. `specs/ui.md` fixes no font, no layout, and no copy, so
// `hud/readouts` groups the runs a frame laid down into the words their spacing
// makes and takes the maximal runs of digits in each as the figures the HUD
// showed: `143 KILLS`, `143`, and a `143` drawn glyph by glyph all answer the
// same, and a `1143` does not.
//
// WHY ONE HARNESS DRIVES BOTH. Every driver switch is off on an isolated run, so
// the only thing that changes between the two frames is the count this point
// poses.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertFalse, assertTrue } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { drewFigure } from "./readouts";

/** The two counts read: the one a run opens on, and one a night reaches. */
const NONE = 0;
const MANY = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the kill count", async () => {
  isolate(h);

  h.debug.setKills(NONE);
  const none = await h.frameCalls();
  assertEqual(h.snapshot().run.kills, NONE, "the count the run holds");
  assertTrue(drewFigure(none, NONE), `the kill count ${NONE} drawn on the HUD`);
  assertFalse(
    drewFigure(none, MANY),
    `${MANY} drawn on the HUD while the count is ${NONE}`,
  );

  h.debug.setKills(MANY);
  const many = await h.frameCalls();
  captureStill(h, "kills");
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertEqual(posed.run.kills, MANY, "the count the run holds");
  assertTrue(drewFigure(many, MANY), `the kill count ${MANY} drawn on the HUD`);
});
