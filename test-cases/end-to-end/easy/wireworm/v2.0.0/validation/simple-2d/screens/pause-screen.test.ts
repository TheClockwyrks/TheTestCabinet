// Wireworm — screens/pause-screen: pausing live play raises a menu carrying all
// three pause items, over a board that is still visible behind it.
//
// Two readings of the paused screen, both from `specs/ui.md`.
//
// THE MENU. The three entries are the case's own copy, PAUSE_ITEMS from
// `src/constants.ts`, matched by substring because a highlighted entry is
// commonly drawn with a marker or padding beside it. The pause is raised by the
// `pause` action's own first bound key — `KeyP`, which drives nothing else — as
// a real key event at the target the engine listens on, over live, active play.
//
// THE BOARD BEHIND IT. "The board stays visible behind the menu"
// (`specs/ui.md`). What decides that is one tile of the board read twice on the
// paused screen: once with a node standing on it, and once with the same tile
// emptied by `clearNode`. Everything else about the two frames is identical —
// the same menu, the same scrim, the same tile — so the difference between them
// is the node alone, and a build whose menu paints the board out reads the same
// colour twice. Nothing here asks what colour a node is or where a build puts
// its menu: the case fixes neither.
//
// The tile sits away from the middle of the stage, where a menu's own copy is
// most likely to be drawn: a node under a letter would be a reading of the
// build's typography rather than of the board behind it.
//
// That the paused board is FROZEN is for the four `screens/pause-freezes-*`
// points to decide.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drewText,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the board is read on: high and to the left, clear of a menu's copy. */
const PROBE_C = 3;
const PROBE_R = 3;

/**
 * How far the tile's colour has to move when the node standing on it is taken
 * away, as RGB distance out of 441.
 *
 * A figure rather than a colour, because the case fixes no palette: what
 * `specs/ui.md` asks is that the board READS through whatever a build lays over
 * it, and a build that draws its node at all separates the two readings by far
 * more than this. 8 of 441 is under 2% of the range — beyond the reach of
 * rounding or a stray anti-aliased edge, and unreachable by a tile that was
 * painted out.
 */
const BOARD_READS = 8;

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const PAUSE_KEY = "KeyP";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws all three pause items over a board that still reads through them", async () => {
  startPlaying(h);
  // One node, at the charge `specs/nodes.md` calls critical: the board's own
  // content, and the state a player is meant to read most easily of the four.
  h.debug.setNode(PROBE_C, PROBE_R, CHARGE_MAX);

  await h.tap(PAUSE_KEY);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );

  const drawn = await drawFrame(h);
  captureStill(h, "pause");
  for (const item of PAUSE_ITEMS) {
    assertEqual(
      drewText(drawn, item),
      true,
      `the pause menu draws the ${item} item (specs/ui.md)`,
    );
  }
  const standing = sampleTile(h, PROBE_C, PROBE_R);

  // The same paused frame with the node taken off the tile.
  h.debug.clearNode(PROBE_C, PROBE_R);
  await h.advance(1);
  const emptied = sampleTile(h, PROBE_C, PROBE_R);

  assertEqual(
    h.snapshot().screen,
    "paused",
    "both readings are of the paused screen",
  );
  assertGreaterThan(
    colorDistance(standing, emptied),
    BOARD_READS,
    "the tile a node stands on reads differently from the same tile emptied, " +
      "so the board is still visible behind the pause menu (specs/ui.md)",
  );
});
