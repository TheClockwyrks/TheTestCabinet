// Trains: not boarding the last train never fails the shift — with the quota met the shift
// still resolves to a WIN when the clock ends. The quota is pre-satisfied, the worker is
// left safely off the lane, and the clock is run out; the real win/fail rule chooses a win.

import { startFresh, primeQuota, setTile, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.last-train-miss");

  await startFresh(api, 3);
  await primeQuota(api, { delivered: { red: 1, blue: 3 }, uniques: ["u-red"] });
  await setTile(api, 8, 8); // safely off any lane
  await api.call("setClock", 2);

  await api.step(2.5); // run the clock out without ever boarding
  const snap = await api.snapshot();
  check.expectEq("missing the last train still wins with the quota met", snap.phase, "won");
  check.expectEq("the shift-complete screen is shown", snap.screen, "level-complete");
  check.expectEq("it is a win, not a failure", snap.level.failReason, null);

  await liveClip(api, 600);
  return check.verdict();
}
