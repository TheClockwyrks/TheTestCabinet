// movement/state-is-drill-side — cutting sideways puts the miner in `drill-side`.
//
// `specs/character.md`'s animation-state table: `drill-side` is "Braced and
// cutting the cell beside it", and the file's precedence list puts the two drill
// states above everything else, so a miner cutting sideways is in that state
// whatever else is true of it. `specs/overview.md` states what the state buys a
// player: "its current state is readable from the frame on screen".
//
// ONE STATE PER POINT. `assets/miner-state-changes-the-frame` reads the five
// states ordinary play walks through and asks that each be DRAWN differently;
// this one is about the state machine reaching `drill-side` at all, which that
// check never enters. A build with no sideways pose loses this point and keeps
// the other, and a build that draws one picture for every state loses the other
// and keeps this.
//
// THE CUT IS REAL. The wall is laid beside the miner, the key is held, and the
// state is read once the cut is under way — the drill is not gated and no state
// is posed, so what is read is the build's own state machine over its own drill.
//
// ISOLATION. A floor to stand on, one rock cell as the wall, and open mine
// everywhere else: nothing else in the scene can put the miner in another state.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveHold,
  layFloor,
  openScene,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 12;
const ROW = 12;

/** The wall the cut goes into: the cell beside the miner's box. */
const WALL_COL = COL + 1;

/** Half a second of held cut, several `DRILL_HIT_INTERVAL`s. */
const CUT_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads drill-side while the miner cuts the cell beside it", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  await h.debug.setTile(WALL_COL, ROW - 1, "rock");
  await standOn(h, COL, ROW, "east");

  const cut = await captureReplay(h, "cut", () =>
    driveHold(h, ACTION_KEY.right, CUT_FRAMES),
  );

  assertEqual(
    cut.snapshot.miner.state,
    "drill-side",
    "specs/character.md: the state while the cell beside the miner is being cut",
  );
});
