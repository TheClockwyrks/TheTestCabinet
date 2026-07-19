// Automated validation for the Hunter item `emerges`.
//
// No bear is present at the start of a crossing; one emerges from the near shore
// only once the critter has advanced a few rows. A fresh crossing shows no bear;
// after the critter is advanced (onto a cleared, safe row) the real emerge logic
// brings a bear out, which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.emerges");

  await startCrossing(api);
  check.expectEq("no bear at the start of a crossing", (await api.snapshot()).bears[0].present, false);

  await api.call("setLane", 15, { cols: [] }); // a safe tile for the advanced critter
  await api.call("placeCritter", 20, 15); // advance a few rows
  const r = await stepUntil(api, (s) => s.bears[0].present, 1.2, 0.05);
  check.expectOk("the bear emerges once the critter has advanced", r.hit);
  check.expectEq("the bear is now present", r.snap.bears[0].present, true);

  // Clip: a climb from the near shore with the bear emerging behind, in real time.
  await startCrossing(api);
  for (const rr of [15, 16, 17, 18]) await api.call("setLane", rr, { cols: [] });
  await api.call("placeCritter", 20, 18);
  await api.call("keyDown", "ArrowUp");
  await api.wait(1400);
  await api.call("keyUp", "ArrowUp");
  await api.wait(400);

  return check.verdict();
}
