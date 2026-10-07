// hud/level-label-drawn — the experience bar carries the level label.
//
// WHERE THE COPY COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Experience | A bar whose filled width scales with `xp / xpToNext`, labeled
// with `LEVEL_LABEL` (`LEVEL`) and the current level, as `LEVEL 4`." The run is
// posed at level 4, which is the level that line spells out, so the frame owes
// the label and the number in that order.
//
// THE WORLD. An isolated `playing` run at level 4: nothing alive, nothing on
// the ground, no weapon and no passive held, every driver switch off. No gem
// exists and no enemy dies, so no gain can move the level off the one posed
// while the frame draws.
//
// WHAT IS READ. Every run of text the frame drew, and whether one of them holds
// `LEVEL 4`. specs/ui.md fixes no font and no layout, so the reading ignores
// case and how much whitespace a build sets between the two words, and takes
// the label as part of a longer run so a build that draws it beside a count or
// under a marker still reads.
//
// TOLERANCE. None: a run of text either holds the label and the level or does
// not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVEL_LABEL } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { assertDrewPhrase } from "./hud";

/** The level posed, the one specs/ui.md spells the label out at. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws LEVEL 4 beside the experience bar at level 4", async () => {
  const posed = isolate(h, { level: LEVEL });
  assertEqual(posed.run.level, LEVEL, "the level posed");

  const { calls } = await h.frameDraw();
  captureStill(h, "label");

  assertEqual(h.snapshot().run.level, LEVEL, "the level the frame drew at");
  assertDrewPhrase(
    calls,
    `${LEVEL_LABEL} ${LEVEL}`,
    "the experience bar's label",
  );
});
