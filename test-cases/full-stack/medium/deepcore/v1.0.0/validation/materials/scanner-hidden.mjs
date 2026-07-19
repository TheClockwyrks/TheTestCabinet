// Automated validation for materials.scanner-hidden.
//
// When no needed material is within scanner range there is no lock and no idle indicator. On the
// surface with a low-tier scanner, both buried nodes are far below range, so the scanner shows no
// lock.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-hidden");

  await newRun(api); // miner on the surface, both nodes far below
  await api.call("grantGear", { scanner: 1 }); // shortest range (6 tiles)

  const s = (await api.snapshot()).scanner;
  check.expectEq("no lock when nothing is in range", s.locked, false);

  await api.call("setAutoStep", true);
  await api.wait(700);
  return check.verdict();
}
