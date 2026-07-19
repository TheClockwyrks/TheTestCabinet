// Automated validation for materials.scanner-hidden.
//
// When no needed material is within scanner range there is no lock and no idle indicator. On the
// surface with a scanner fitted, both buried nodes are hundreds of rows below range, so the scanner
// shows no lock.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-hidden");

  await newRun(api); // miner on the surface, both nodes far below
  await api.call("grantGear", { scanner: 2 }); // the first scanner level (range 10) — still far short

  const s = (await api.snapshot()).scanner;
  check.expectEq("no lock when nothing is in range", s.locked, false);

  await api.call("setAutoStep", true);
  await api.wait(700);
  return check.verdict();
}
