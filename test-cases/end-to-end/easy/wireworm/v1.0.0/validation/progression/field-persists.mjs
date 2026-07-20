// Automated validation for progression.field-persists: the node field carries over
// into the next level rather than resetting.
//
// A few known nodes and a short worm are posed; clearing the worm advances the level
// through the real levelClear (which does NOT clear the field). The pre-placed nodes
// are still present, at their charges, on the next level.

import { chargeAt, fireAndResolve, freshBoard, setWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.field-persists");

  await freshBoard(api);
  await api.call("setNode", 5, 5, 2);
  await api.call("setNode", 6, 6, 1);
  await api.call("setNode", 7, 7, 0);
  await setWorm(api, [{ c: 20, r: 15 }], 1, 1);
  await api.call("setCursor", tileCX(20), 688);

  const snap = await fireAndResolve(api);
  check.expectEq("the level advanced", snap.level, 2);
  check.expectEq("a charged node persists across the advance (5,5)", chargeAt(snap, 5, 5), 2);
  check.expectEq("a charged node persists across the advance (6,6)", chargeAt(snap, 6, 6), 1);
  check.expectEq("an inert node persists across the advance (7,7)", chargeAt(snap, 7, 7), 0);

  // A live clip of the field standing after the advance.
  await freshBoard(api);
  await api.call("setNode", 5, 5, 2);
  await api.call("setNode", 6, 6, 1);
  await setWorm(api, [{ c: 20, r: 15 }], 1, 1);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(1200);

  return check.verdict();
}
