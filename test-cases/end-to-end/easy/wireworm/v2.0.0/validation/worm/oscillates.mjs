// Automated validation for worm.oscillates: the worm's vertical heading flips at
// the extremes — it reverses at the floor and again at the top — so it oscillates up
// and down rather than leaving the board.
//
// The worm is posed at each extreme heading into it; the dv flip is produced by the
// real stepWorm drop path and read back.

import {
  freshBoard,
  head,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.oscillates");

  // Floor: at the bottom row heading down, the next drop flips dv to up.
  await freshBoard(api);
  await setWorm(api, straightWorm(39, 19, 3, 1), 1, 1); // right edge, bottom row, heading down
  await api.call("setCursor", 100, 700); // clear of the worm's column
  const floor = await wormStep(api);
  check.expectEq("the worm reverses to climbing at the floor", floor.worms[0].dv, -1);
  check.expectLt("the head steps upward off the floor", head(floor).r, 19);

  // Ceiling: at the top row heading up, the next drop flips dv to down.
  await freshBoard(api);
  await setWorm(api, straightWorm(0, 0, 3, -1), -1, -1); // left edge, top row, heading up
  const ceil = await wormStep(api);
  check.expectEq("the worm reverses to descending at the top", ceil.worms[0].dv, 1);
  check.expectGt("the head steps downward off the top", head(ceil).r, 0);

  // A live clip of the worm winding down and back up.
  await freshBoard(api);
  await setWorm(api, straightWorm(20, 15, 6, 1), 1, 1);
  await liveClip(api, 1600);

  return check.verdict();
}
