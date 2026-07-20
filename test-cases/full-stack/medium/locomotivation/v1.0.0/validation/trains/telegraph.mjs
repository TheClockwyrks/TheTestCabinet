// Trains: a crossing signal reads clear with no train, warning as one approaches within the
// telegraph lead, and danger as it is upon the crossing. Level 1's signal watches the row-8
// lane; a real commuter is spawned and advanced toward the crossing.

import { startFresh, liveClip } from "../_helpers.mjs";

const stateOf = (snap) => (snap.signals.find((s) => s.id === "s-T0") ?? snap.signals[0]).state;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.telegraph");

  await startFresh(api, 1);
  check.expectEq("the signal is clear with no train", stateOf(await api.snapshot()), "clear");

  await api.call("spawnTrain", { line: 8, orientation: "horizontal", dir: "east", kind: "commuter", headPos: 0 });
  await api.step(1 / 60);
  check.expectEq("the signal warns as the train approaches", stateOf(await api.snapshot()), "warning");

  await api.step(0.5); // the train reaches the crossing
  check.expectEq("the signal shows danger upon the crossing", stateOf(await api.snapshot()), "danger");

  await liveClip(api, 800);
  return check.verdict();
}
