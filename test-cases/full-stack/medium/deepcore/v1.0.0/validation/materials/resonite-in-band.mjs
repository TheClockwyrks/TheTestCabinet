// Automated validation for materials.resonite-in-band.
//
// Every mine contains a buried Resonite node in the Rockbed band (guaranteed, so a run can never
// be soft-locked by an unlucky map). We enumerate both guaranteed nodes, confirm one is Resonite
// in the rockbed, then (on the same seed) reach it and capture it.

import { bothNodes } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.resonite-in-band");

  const nodes = await bothNodes(api, 1);
  const res = nodes.find((n) => n.material === "resonite");
  check.expectOk("a Resonite node exists in the mine", !!res);
  check.expectEq("the Resonite node is in the rockbed band", res ? res.band : null, "rockbed");

  // Reach it on the same seed (its tile is intact this pass) and capture it.
  if (res) {
    await api.reset({ seed: 1 });
    await api.call("startExpedition", "standard", "standard");
    await api.call("teleport", res.col, res.row - 2); // two tiles above, node in view below
    await api.wait(150);
  }
  await api.screenshot("node");

  return check.verdict();
}
