// Automated validation for the Controls sub-item `wasd`.
//
// W/A/S/D steer the snake identically to the arrow keys. A round is started from the
// title with injected keys, then W -> A -> S -> D are pressed in turn from valid
// facings (each flowing through the real key handling), and one real tick applies each
// turn, read back from the snapshot. Chaining up -> left -> down -> right exercises all
// four keys without a reversal.

import { TICK_DT, startWithKeys, hLane, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.wasd");

  await startWithKeys(api); // snake starts moving right

  async function steer(code) {
    await api.call("press", code);
    await api.step(TICK_DT);
    return (await api.snapshot()).dir;
  }

  check.expectEq("W steers up (from right)", await steer("KeyW"), "up");
  check.expectEq("A steers left (from up)", await steer("KeyA"), "left");
  check.expectEq("S steers down (from left)", await steer("KeyS"), "down");
  check.expectEq("D steers right (from down)", await steer("KeyD"), "right");

  await liveClip(api, { snake: hLane(6, 8, 4), pellet: { col: 16, row: 8 } });
  return check.verdict();
}
