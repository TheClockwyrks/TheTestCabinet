// Automated validation for the Scoring item `row`.
//
// Advancing to a new row scores ten points per net new row. Three real up-hops are
// driven from the near shore across cleared ice tiles, and the score read back. See
// validation/_helpers.mjs.

import { startCrossing, ROW_NEAR } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.row");

  await startCrossing(api);
  await api.call("setScore", 0);
  for (const r of [15, 16, 17, 18]) await api.call("setLane", r, { cols: [] });

  for (let i = 0; i < 3; i += 1) {
    await api.call("press", "ArrowUp");
    await api.step(0.15);
  }
  const s = await api.snapshot();
  check.expectEq("advanced three rows", ROW_NEAR - s.critter.row, 3);
  check.expectEq("each row advanced scores ten points", s.score, 30);

  // Clip: a steady climb scoring row by row in real time.
  await startCrossing(api);
  for (const r of [15, 16, 17, 18]) await api.call("setLane", r, { cols: [] });
  await api.call("keyDown", "ArrowUp");
  await api.wait(500);
  await api.call("keyUp", "ArrowUp");
  await api.wait(300);

  return check.verdict();
}
