// Automated validation for cursor.fires-up: a bolt travels straight up the cursor's
// column and is consumed by the first thing it meets; on a clear column it vanishes
// at the top.
//
// Two preconditions: a node above the cursor (the bolt should stop at it) and a
// clear column (the bolt should exit the top, changing nothing). Both resolutions
// come from the real updateBolts/resolveBolt and are read back.

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cursor.fires-up");

  // A node directly above the cursor: the bolt stops at it.
  await freshBoard(api);
  await api.call("setNode", 20, 8, 0);
  await api.call("setCursor", tileCX(20), 688);
  const hit = await fireAndResolve(api);
  check.expectEq("the bolt stops at the first node in its column", chargeAt(hit, 20, 8), -1);
  check.expectEq("the bolt is consumed by the hit", hit.bolts.length, 0);

  // A clear column: the bolt exits the top and changes nothing.
  await freshBoard(api);
  await api.call("setCursor", tileCX(5), 688);
  const clear = await fireAndResolve(api);
  check.expectEq("the bolt vanishes at the top of a clear column", clear.bolts.length, 0);
  check.expectEq("nothing on the board changed", clear.nodes.length, 0);

  // A live clip of a bolt travelling up and stopping at a node.
  await freshBoard(api);
  await api.call("setNode", 20, 6, 0);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
