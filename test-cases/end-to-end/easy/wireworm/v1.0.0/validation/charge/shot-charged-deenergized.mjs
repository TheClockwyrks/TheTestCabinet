// Automated validation for charge.shot-charged-deenergized: a bolt into a charged
// node knocks it down one level without removing it.
//
// A charge-2 node above the cursor is the precondition; each shot's effect is
// produced by the real resolveBolt -> hitNode and read back. Three successive shots
// take it 2 -> 1 -> 0 -> gone, proving a charged node resists clearing.

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

const C = 20;
const R = 10;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.shot-charged-deenergized");

  await freshBoard(api);
  await api.call("setNode", C, R, 2);
  await api.call("setCursor", tileCX(C), 688);

  const s1 = await fireAndResolve(api);
  check.expectEq("the first shot knocks charge 2 down to 1 (still present)", chargeAt(s1, C, R), 1);

  const s2 = await fireAndResolve(api);
  check.expectEq("the second shot knocks it down to 0 (still present)", chargeAt(s2, C, R), 0);

  const s3 = await fireAndResolve(api);
  check.expectEq("the third shot (now inert) clears it", chargeAt(s3, C, R), -1);

  // A live clip of a charged node de-energizing under fire.
  await freshBoard(api);
  await api.call("setNode", C, R, 2);
  await api.call("setCursor", tileCX(C), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(500);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
