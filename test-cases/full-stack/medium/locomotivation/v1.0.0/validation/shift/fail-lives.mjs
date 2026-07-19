// Shift: exhausting the lives fails the shift (out of lives). Lives are set to one as a
// precondition, then a real train kills the worker; the respawn beat with no lives left
// resolves to a failure through the real rule.

import { setTile, startFresh, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.fail-lives");

  await startFresh(api, 1);
  await api.call("setLives", 1);
  await setTile(api, 8, 10);
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400 });

  await api.step(0.1); // the lethal hit spends the last life
  await api.step(1.2); // the respawn beat with no lives left resolves the failure
  const snap = await api.snapshot();
  check.expectEq("out of lives fails the shift", snap.screen, "level-failed");
  check.expectEq("the failure reason is out of lives", snap.level.failReason, "out-of-lives");

  await settle(api, 150);
  await api.screenshot("result");
  return check.verdict();
}
