// Automated validation for progression.level-clear-advances: clearing every worm
// segment advances the run to the next level.
//
// A short worm on the level's active run is the precondition; clearing it with a real
// shot triggers the real levelClear, and the level increments while the game keeps
// playing — read back from the snapshot.

import { fireAndResolve, freshBoard, setWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.level-clear-advances");

  await freshBoard(api);
  await setWorm(api, [{ c: 20, r: 15 }], 1, 1); // a single-segment worm on the active run
  await api.call("setCursor", tileCX(20), 688);

  check.expectEq("the run starts on level 1", (await api.snapshot()).level, 1);
  const snap = await fireAndResolve(api);
  check.expectEq("clearing the worm advances the level", snap.level, 2);
  check.expectEq("the game keeps playing", snap.screen, "playing");

  // A live clip of a level advancing.
  await freshBoard(api);
  await setWorm(api, [{ c: 20, r: 15 }], 1, 1);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(900);

  return check.verdict();
}
