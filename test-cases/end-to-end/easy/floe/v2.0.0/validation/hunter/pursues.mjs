// Automated validation for the Hunter item `pursues`.
//
// The bear pursues the critter's position: over time the distance between them
// shrinks. The critter is fixed on the median and a bear placed a few tiles away;
// the real pursuit brain closes the gap as the simulation steps, which the
// snapshots read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

const manhattan = (b, c) => Math.abs(b.col - c.col) + Math.abs(b.row - c.row);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.pursues");

  await startCrossing(api);
  await api.call("placeCritter", 20, 10); // median, solid
  await api.call("setBear", 0, { col: 5, row: 10 });

  const s0 = await api.snapshot();
  const d0 = manhattan(s0.bears[0], s0.critter);
  await api.step(1.0);
  const s1 = await api.snapshot();
  const d1 = manhattan(s1.bears[0], s1.critter);

  check.expectLt("the bear closes on the critter (distance shrinks)", d1, d0);
  check.expectNe("the critter is not yet caught", s1.phase, "dying");

  // Clip: the bear closing in, in real time.
  await startCrossing(api);
  await api.call("placeCritter", 20, 10);
  await api.call("setBear", 0, { col: 5, row: 10 });
  await api.wait(1500);

  return check.verdict();
}
