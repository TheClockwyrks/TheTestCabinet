// Automated validation for quality.teslaprime-terminal: a Tesla-Prime (T5) piece offers no
// quality-combine — the top rung cannot climb further.
//
// Two Tesla-Prime capacitors are placed and a combine attempted; both remain, and no higher
// tier is produced.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.teslaprime-terminal");

  await startBuild(api);
  const a = await placeCandidate(api, "capacitor", 5, 6, 7);
  const b = await placeCandidate(api, "capacitor", 5, 10, 7);

  await api.call("setCombineSet", [a.id, b.id]);
  await api.call("combine", a.id); // refused: T5 is the apex

  const s = await snap(api);
  check.expectEq("both Tesla-Prime pieces remain (no further combine)", s.towers.filter((t) => t.kind === "candidate" && t.quality === 5).length, 2);
  check.expectEq("no tier above Tesla-Prime was produced", s.towers.filter((t) => t.quality > 5).length, 0);

  await api.screenshot("apex");
  return check.verdict();
}
