// Automated validation for the Hunter item `safe-bays`.
//
// The bear never enters the far-shore wall or a bay, so a critter safe in a filled
// bay is permanently safe from it. The critter is placed in a filled bay (row 1)
// and a bear set below it on cleared water; over many steps the real pursuit never
// reaches row 1 and never catches the critter. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.safe-bays");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setBays", [true, false, false, false, false]);
  for (const r of [2, 3]) await api.call("setLane", r, { cols: [] }); // open water below the bay
  await api.call("placeCritter", 3, 1); // safe in the filled bay
  await api.call("setBear", 0, { col: 3, row: 3 });

  let minRow = 99;
  for (let k = 0; k < 40; k += 1) {
    await api.step(0.05);
    const s = await api.snapshot();
    if (s.bears[0].present) minRow = Math.min(minRow, s.bears[0].row);
  }
  check.expectGe("the bear never enters the far-shore wall / a bay (row < 2)", minRow, 2);
  const s = await api.snapshot();
  check.expectNe("the critter in the filled bay is never caught", s.phase, "dying");
  check.expectEq("the critter kept all lives", s.lives, 3);

  // Clip: the bear pressed against the far shore, unable to enter, in real time.
  await startCrossing(api);
  await api.call("setBays", [true, false, false, false, false]);
  for (const r of [2, 3]) await api.call("setLane", r, { cols: [] });
  await api.call("placeCritter", 3, 1);
  await api.call("setBear", 0, { col: 3, row: 3 });
  await api.call("setAutoStep", true);
  await api.wait(1800);

  return check.verdict();
}
