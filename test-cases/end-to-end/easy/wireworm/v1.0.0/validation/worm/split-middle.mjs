// Automated validation for worm.split-middle: a bolt into a middle segment splits
// the worm into two independent worms.
//
// A straight worm on a low row (so the bolt resolves before the worm steps) is the
// precondition; the split is produced by the real hitWorm -> splitRuns and read
// back as two worms.

import { fireAndResolve, freshBoard, setWorm, straightWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.split-middle");

  await freshBoard(api);
  await setWorm(api, straightWorm(10, 15, 5, 1), 1, 1); // segments at columns 10..6
  await api.call("setCursor", tileCX(8), 688); // aimed at the middle segment (column 8)

  check.expectEq("one worm before the shot", (await api.snapshot()).worms.length, 1);
  const snap = await fireAndResolve(api);
  check.expectEq("a middle-segment hit splits the worm into two", snap.worms.length, 2);

  // A live clip of the split.
  await freshBoard(api);
  await setWorm(api, straightWorm(10, 15, 5, 1), 1, 1);
  await api.call("setCursor", tileCX(8), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(900);

  return check.verdict();
}
