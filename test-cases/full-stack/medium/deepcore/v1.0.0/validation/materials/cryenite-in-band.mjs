// Automated validation for materials.cryenite-in-band.
//
// Every mine contains a buried Cryenite node in the Deepstone band (guaranteed). We enumerate both
// guaranteed nodes, confirm one is Cryenite in the deepstone, then (on the same seed) reach it and
// capture it.

import { bothNodes } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.cryenite-in-band");

  const nodes = await bothNodes(api, 1);
  const cry = nodes.find((n) => n.material === "cryenite");
  check.expectOk("a Cryenite node exists in the mine", !!cry);
  check.expectEq("the Cryenite node is in the deepstone band", cry ? cry.band : null, "deepstone");

  if (cry) {
    await api.reset({ seed: 1 });
    await api.call("startExpedition", "standard", "standard");
    await api.call("teleport", cry.col, cry.row - 2);
    await api.wait(150);
  }
  await api.screenshot("node");

  return check.verdict();
}
