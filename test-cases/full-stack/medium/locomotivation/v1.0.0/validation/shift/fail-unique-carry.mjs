// Shift: dying while carrying a unique destroys it and fails the shift immediately, even
// with lives remaining. The worker carries a unique (precondition) with full lives; a real
// train kills it, and the lost unique fails the shift though a life was left.

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.fail-unique-carry");

  await startFresh(api, 1);
  await api.call("setLives", 3);
  await setTile(api, 8, 10);
  await api.call("givePackage", { color: "red", weightClass: "load", archetype: "unique" });
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400 });

  await api.step(0.1); // the lethal hit destroys the carried unique
  const snap = await api.snapshot();
  check.expectEq("dying with the unique fails the shift", snap.screen, "level-failed");
  check.expectEq("the failure reason is a lost unique", snap.level.failReason, "unique-lost");
  check.expectEq("it failed despite a life remaining", snap.level.lives, 2);

  await liveClip(api, 600);
  return check.verdict();
}
