// Automated validation for the Controls sub-item `arrows`.
//
// The arrow keys steer the snake. A round is started from the title with injected keys
// (so the game stays under normal keyboard control), then each arrow is pressed in turn
// from a valid facing — the injected key flows through the real key handling — and one
// real tick applies the turn, which the snapshot reads back. Chaining up -> left ->
// down -> right exercises all four arrows without a reversal.

import { TICK_DT, startWithKeys, hLane, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arrows");

  await startWithKeys(api); // snake starts moving right

  async function steer(code) {
    await api.call("press", code);
    await api.step(TICK_DT);
    return (await api.snapshot()).dir;
  }

  check.expectEq("ArrowUp steers up (from right)", await steer("ArrowUp"), "up");
  check.expectEq("ArrowLeft steers left (from up)", await steer("ArrowLeft"), "left");
  check.expectEq("ArrowDown steers down (from left)", await steer("ArrowDown"), "down");
  check.expectEq("ArrowRight steers right (from down)", await steer("ArrowRight"), "right");

  await liveClip(api, { snake: hLane(6, 8, 4), pellet: { col: 16, row: 8 } });
  return check.verdict();
}
