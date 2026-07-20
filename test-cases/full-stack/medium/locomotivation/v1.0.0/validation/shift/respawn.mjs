// Shift: a death respawns the worker at the spawn with empty hands, spends a life, and
// leaves already-banked deliveries intact. One red is banked as a precondition; the worker
// dies carrying a package, then respawns — the banked red persists, the carried load is gone.

import { setTile, startFresh, deliveredOf, tileCenterX, tileCenterY, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.respawn");

  await startFresh(api, 1);
  await api.call("setDelivered", "red", 1); // banked progress
  await setTile(api, 8, 10);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400 });

  await api.step(0.1); // die
  await api.step(1.2); // respawn beat
  const snap = await api.snapshot();
  check.expectEq("the worker is playing again after respawn", snap.phase, "playing");
  check.expectClose("respawned at the spawn (x)", snap.worker.x, tileCenterX(3), 0.5);
  check.expectClose("respawned at the spawn (y)", snap.worker.y, tileCenterY(14), 0.5);
  check.expectEq("respawns with empty hands", snap.worker.carried.length, 0);
  check.expectEq("a life was spent", snap.level.lives, 2);
  check.expectEq("the banked delivery persisted", deliveredOf(snap, "red"), 1);

  await liveClip(api, 600);
  return check.verdict();
}
