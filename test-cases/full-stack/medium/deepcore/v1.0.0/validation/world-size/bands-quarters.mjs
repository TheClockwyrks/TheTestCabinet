// Automated validation for world-size.bands-quarters.
//
// At every size the four bands remain equal quarters of the descent, keeping their identities. We
// read the band at the quarter-depths of the Standard mine and again of the (half-depth) Quick mine.

import { SPAWN_COL } from "../_helpers.mjs";

async function bandAt(api, col, row) {
  const t = await api.call("tileAt", col, row);
  return t ? t.band : null;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("world-size.bands-quarters");
  const col = SPAWN_COL;

  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "standard"); // coreRow 500, quarters of 125
  check.expectEq("Standard topsoil at ~1/8 depth", await bandAt(api, col, 60), "topsoil");
  check.expectEq("Standard rockbed at ~3/8 depth", await bandAt(api, col, 190), "rockbed");
  check.expectEq("Standard deepstone at ~5/8 depth", await bandAt(api, col, 310), "deepstone");
  check.expectEq("Standard coreshell at ~7/8 depth", await bandAt(api, col, 440), "coreshell");
  await api.wait(120);
  await api.screenshot("bands");

  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "quick"); // coreRow 250, quarters of ~62
  check.expectEq("Quick topsoil at ~1/8 depth", await bandAt(api, col, 30), "topsoil");
  check.expectEq("Quick rockbed at ~3/8 depth", await bandAt(api, col, 90), "rockbed");
  check.expectEq("Quick deepstone at ~5/8 depth", await bandAt(api, col, 150), "deepstone");
  check.expectEq("Quick coreshell at ~7/8 depth", await bandAt(api, col, 210), "coreshell");

  return check.verdict();
}
