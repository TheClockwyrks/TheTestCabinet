// Automated validation for progression.bonus-life: crossing a 12,000-point milestone
// through real scoring grants a bonus life.
//
// The score is set just below the milestone as a precondition; a real +score event
// (shooting a worm head for 100) crosses 12,000 through the real addScore path, which
// grants the life. The life gain is read back — nothing fabricates it.

import { fireAndResolve, freshBoard, setWorm, straightWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.bonus-life");

  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setScore", 11990); // just below the 12,000 milestone
  await setWorm(api, straightWorm(20, 15, 3, 1), 1, 1); // head at column 20
  await api.call("setCursor", tileCX(20), 688);

  check.expectEq("three lives before the milestone", (await api.snapshot()).lives, 3);
  const snap = await fireAndResolve(api);
  check.expectGe("real scoring crossed the 12,000 milestone", snap.score, 12000);
  check.expectEq("crossing 12,000 grants a bonus life", snap.lives, 4);

  // A live clip of the bonus life at the milestone.
  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setScore", 11990);
  await setWorm(api, straightWorm(20, 15, 3, 1), 1, 1);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(800);

  return check.verdict();
}
