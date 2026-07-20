// Trains: contact with the FLANK of a passing car — not only its leading edge — is lethal.
// The worker is posed under a mid-body car (the head is already well past it), so the only
// contact is a side one; a single step resolves the lethal overlap.

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.lethal-side");

  await startFresh(api, 1);
  await setTile(api, 8, 10); // worker at x=340 on the lane
  // headPos 400 puts the leading edge past the worker, so the worker sits under a mid car flank.
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400 });

  await api.step(0.1);
  const snap = await api.snapshot();
  check.expectEq("a flank contact killed the worker", snap.level.lives, 2);
  check.expectOk("the worker is in the death/respawn beat", ["dying", "respawning"].includes(snap.phase));

  await liveClip(api, 600);
  return check.verdict();
}
