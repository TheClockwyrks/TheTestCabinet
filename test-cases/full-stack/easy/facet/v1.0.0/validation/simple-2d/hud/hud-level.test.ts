// Facet — hud/hud-level: the playing screen draws the LEVEL readout, and the
// figure beside the label is the level the state holds.
//
// specs/ui.md tables the readouts of the `playing` screen and gives this one a
// name of its own — `HUD_LEVEL_LABEL` (`LEVEL`) — against `state.level`. A
// player who cannot read the level cannot read how far the round has come, so
// the point is both halves at once: the label is on the frame, and the figure
// the frame carries is the level rather than a `1` printed for every round.
//
// WHY LEVEL 7. specs/rules.md derives the level's target as
// `LEVEL_TARGET_STEP` (`2000`) times the level, so level 7 asks for `14000` —
// a figure carrying no `7` at all. With the score and the level score posed to
// `0`, the only decimal `7` any readout on this frame can be built from is the
// level itself, and a build that drew the label beside the wrong figure, or
// beside a level frozen at `1`, has nothing on the frame that answers for it.
//
// The other two figures are posed rather than inherited so the frame's digits
// are the scenario's rather than whatever a previous check left behind: the
// reading below is a search over everything the frame drew, and it is only as
// sharp as the figures that share the frame with the one under test.
//
// The board is posed rather than dealt because this point is not about what is
// on the board: the harness's `loadBoard` poses a board on `playing` with
// `phase` `idle` and leaves
// `level` where it stands, and `setLevel` then writes the figure under test.
// Nothing here settles a chain, so the round stays on `playing` even though the
// quiet filler carries no legal swap of its own.
//
// The copy is read through `frameText`, which hands back every string one frame
// put on screen, and `showsText` decides whether a string is among them across
// every shape specs/ui.md leaves open — one call per line, one per word, one
// per glyph, or a figure drawn beside its label in a single run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { quietBoard } from "../board";
import { HUD_LEVEL_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  type Harness,
} from "../harness";

/** The posed level, whose target (`14000`) carries no `7` of its own. */
const POSED_LEVEL = 7;

let h: Harness;

/** The frame showed `wanted`, or the failure names it beside what it drew. */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the playing screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the level label and the level the state holds", async () => {
  loadBoard(h, quietBoard());
  h.debug.setLevel(POSED_LEVEL);
  // Both banked figures at zero, so nothing else on the frame is built from a
  // digit that could stand in for the level.
  h.debug.setScore(0);
  h.debug.setLevelScore(0);

  // The state the frame below is read against. A build whose `setLevel` did not
  // take fails here rather than at the reading, which says which of the two
  // broke.
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the readouts sit on");
  assertEqual(posed.level, POSED_LEVEL, "the posed level");
  assertEqual(posed.score, 0, "the posed score");
  assertEqual(posed.levelScore, 0, "the posed level score");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "hud");

  requireCopy(drawn, HUD_LEVEL_LABEL);
  requireCopy(drawn, String(POSED_LEVEL));
});
