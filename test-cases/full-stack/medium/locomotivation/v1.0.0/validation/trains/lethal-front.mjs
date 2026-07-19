// Trains: a worker on the lane struck by an oncoming train's leading edge is killed. The
// worker is posed on a lane and a train approaches from the entry edge; the real train
// advance and lethal-overlap code kill it when the FRONT arrives.

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.lethal-front");

  await startFresh(api, 1);
  await setTile(api, 8, 10);
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 0 });
  check.expectEq("full lives before the train arrives", (await api.snapshot()).level.lives, 3);

  await api.step(3.9); // the front reaches the worker (~3.6 s) within the death beat
  const snap = await api.snapshot();
  check.expectEq("the train front killed the worker (a life spent)", snap.level.lives, 2);
  check.expectOk("the worker is in the death/respawn beat", ["dying", "respawning"].includes(snap.phase));

  await liveClip(api, 700);
  return check.verdict();
}
