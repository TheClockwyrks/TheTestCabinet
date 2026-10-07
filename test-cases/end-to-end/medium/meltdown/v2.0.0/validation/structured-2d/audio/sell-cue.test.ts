// Meltdown — audio/sell-cue: `KeyS` on a selected tower plays the `sell` cue on
// the frame the sale resolves.
//
// `specs/audio.md` binds `sell` to "a placed tower is sold" and fixes the frame:
// a cue "is raised by the frame that resolves the event it answers".
// `specs/controls.md` binds the `sell` action to `KeyS` and `specs/building.md`
// fixes what the sale does — the refund paid, the tower removed, its footprint
// reopened — on that one frame.
//
// THE SALE IS THE PLAYER'S. No operation of the debug surface plays a cue and
// none can (`specs/instrumentation.md`), so `sellTower` does not appear below:
// the key is pressed and released at the engine's own event target and the
// action's edge is read on the frame that follows, which is the only route with a
// frame for a cue to belong to.
//
// NOTHING ELSE CAN SOUND HERE. The floor carries one Arc and no surge, so no
// shot resolves, nothing dies, nothing leaks and nothing trips; the run is in its
// build phase with the world gate shut, so no wave is released and none clears.
// That is what makes "the sell cue and nothing else" a reading of the build
// rather than of the scenario.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn } from "./cues";

/** The tile the Arc's 2x2 footprint is anchored on: quiet floor, off every opening. */
const TOWER = { col: 10, row: 5 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the sell cue on the frame the sale resolves", async () => {
  startRun(h);
  const arc = poseTower(h, "arc", TOWER.col, TOWER.row, 0);
  // Selected as a precondition: `setSelected` opens the inspector and nothing
  // else (specs/instrumentation.md). What `sell` needs is a selected tower, and
  // which press selected it is `controls/pointer-selects-a-tower`'s point.
  h.debug.setSelected(arc);
  assertEqual(
    h.snapshot().selected,
    arc,
    "posing: the Arc is the selected tower (specs/instrumentation.md)",
  );

  // Subscribed after the floor is posed, so what is read is the press alone.
  const played = watchCues(h);

  // The real registered action, read as a press edge on the frame that follows
  // (specs/controls.md, The actions).
  await tapAction(h, "sell");
  const frame = h.engine.frame().count;
  captureStill(h, "sell");

  assertLength(
    h.snapshot().towers,
    0,
    "towers on the floor after the press: the sale resolved " +
      "(specs/building.md, Selling)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    "cues that played on any frame before the sale — a cue is raised by the " +
      "frame that resolves the event it answers (specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.sell],
    "the cues that played on the frame the sale resolved: the sell cue, and " +
      "nothing else (specs/audio.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the gain the sell cue played at on an unmuted bus (specs/audio.md)",
  );
});
