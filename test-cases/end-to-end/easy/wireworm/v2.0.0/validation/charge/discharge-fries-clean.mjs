// Automated validation for charge.discharge-fries-clean: worm segments within 2
// tiles of a detonated node are destroyed by the discharge and leave NO node.
//
// A critical node with a worm laid alongside it are the preconditions; the fry is
// produced by the real detonate -> fryWorms path when the shot lands. The worm sits
// on a low row so the bolt resolves before the worm steps, catching it in place. The
// near segments are gone AND leave no node (unlike a bolt-killed segment); segments
// beyond the blast survive.

import {
  chargeAt,
  fireAndResolve,
  freshBoard,
  segmentAt,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

const R = 16;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.discharge-fries-clean");

  await freshBoard(api);
  await api.call("setNode", 10, R, 3); // critical node, shot from below
  // A worm along row R from column 11 to 18 (head at 18). Columns 11 and 12 are
  // within 2 of the critical node; 13+ are beyond it.
  await setWorm(api, straightWorm(18, R, 8, 1), 1, 1);
  await api.call("setCursor", tileCX(10), 688);

  const snap = await fireAndResolve(api);

  check.expectOk("the near segment at 11 is fried", !segmentAt(snap, 11, R));
  check.expectOk("the near segment at 12 is fried", !segmentAt(snap, 12, R));
  check.expectEq("the fried tile at 11 holds no node", chargeAt(snap, 11, R), -1);
  check.expectEq("the fried tile at 12 holds no node", chargeAt(snap, 12, R), -1);
  check.expectGt("segments beyond the blast survive as a worm", snap.worms.length, 0);

  // A live clip of a discharge frying worm segments.
  await freshBoard(api);
  await api.call("setNode", 10, R, 3);
  await setWorm(api, straightWorm(18, R, 8, 1), 1, 1);
  await api.call("setCursor", tileCX(10), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(800);

  return check.verdict();
}
