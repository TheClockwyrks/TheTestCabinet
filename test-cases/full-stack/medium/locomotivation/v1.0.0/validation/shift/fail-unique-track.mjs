// Shift: a unique required package destroyed by a train fails the shift immediately,
// regardless of clock or lives. A unique is placed on the track (precondition) with the
// worker safely away; a real train smashes it and the real rule fails the shift.

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.fail-unique-track");

  await startFresh(api, 1);
  await setTile(api, 3, 14); // safely off the track
  await api.call("spawnGroundPackage", { col: 6, row: 8, color: "red", weightClass: "load", archetype: "unique" });
  await api.call("spawnTrain", { line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 300 });

  await api.step(0.2); // the train smashes the unique
  const snap = await api.snapshot();
  check.expectEq("losing a unique fails the shift", snap.screen, "level-failed");
  check.expectEq("the failure reason is a lost unique", snap.level.failReason, "unique-lost");

  await liveClip(api, 600);
  return check.verdict();
}
