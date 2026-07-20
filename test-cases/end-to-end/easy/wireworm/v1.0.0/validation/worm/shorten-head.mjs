// Automated validation for worm.shorten-head: a bolt into the head shortens the
// worm by one segment, leaving a single worm.
//
// A straight worm on a low row is the precondition; the shorten is produced by the
// real hitWorm on the head segment and read back (still one worm, one shorter).

import { fireAndResolve, freshBoard, setWorm, straightWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.shorten-head");

  await freshBoard(api);
  await setWorm(api, straightWorm(12, 15, 5, 1), 1, 1); // head at column 12, tail at 8
  await api.call("setCursor", tileCX(12), 688); // aimed at the head

  const snap = await fireAndResolve(api);
  check.expectEq("still a single worm after a head hit", snap.worms.length, 1);
  check.expectEq("the worm is one segment shorter", snap.worms[0].segments.length, 4);

  await freshBoard(api);
  await setWorm(api, straightWorm(12, 15, 5, 1), 1, 1);
  await api.call("setCursor", tileCX(12), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(900);

  return check.verdict();
}
