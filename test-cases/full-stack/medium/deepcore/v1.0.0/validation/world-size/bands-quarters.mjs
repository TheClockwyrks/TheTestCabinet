// Automated validation for world-size.bands-quarters.
//
// At every size the four bands remain equal quarters of the descent, keeping their identities. We
// read the band at the quarter-depths of the Standard mine and again of the (half-depth) Quick mine.

import { SPAWN_COL } from "../_helpers.mjs";

async function bandAt(api, col, row) {
  const t = await api.call("tileAt", col, row);
  return t ? t.band : null;
}

export default function item() {
  const col = SPAWN_COL;
  const std = {};
  const quick = {};

  return {
    id: "world-size.bands-quarters",

    // The Standard mine, read at its four quarter-depths. All instant, so it belongs here.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "standard"); // coreRow 500, quarters of 125
      std.topsoil = await bandAt(api, col, 60);
      std.rockbed = await bandAt(api, col, 190);
      std.deepstone = await bandAt(api, col, 310);
      std.coreshell = await bandAt(api, col, 440);
    },

    // The Standard capture needs a painted frame, so it runs here behind a real settle. The Quick
    // mine is then generated with `startExpedition` rather than a reset — a reset inside `act` would
    // hand the build back its manual clock and freeze the recording. The seed was fixed in
    // `arrange`, and band boundaries follow from the core depth alone, not from the seed.
    async act(api) {
      await api.settle(120);
      await api.screenshot("bands");

      await api.call("startExpedition", "standard", "quick"); // coreRow 250, quarters of ~62
      quick.topsoil = await bandAt(api, col, 30);
      quick.rockbed = await bandAt(api, col, 90);
      quick.deepstone = await bandAt(api, col, 150);
      quick.coreshell = await bandAt(api, col, 210);
    },

    async assert(api, check) {
      check.expectEq("Standard topsoil at ~1/8 depth", std.topsoil, "topsoil");
      check.expectEq("Standard rockbed at ~3/8 depth", std.rockbed, "rockbed");
      check.expectEq(
        "Standard deepstone at ~5/8 depth",
        std.deepstone,
        "deepstone",
      );
      check.expectEq(
        "Standard coreshell at ~7/8 depth",
        std.coreshell,
        "coreshell",
      );
      check.expectEq("Quick topsoil at ~1/8 depth", quick.topsoil, "topsoil");
      check.expectEq("Quick rockbed at ~3/8 depth", quick.rockbed, "rockbed");
      check.expectEq(
        "Quick deepstone at ~5/8 depth",
        quick.deepstone,
        "deepstone",
      );
      check.expectEq(
        "Quick coreshell at ~7/8 depth",
        quick.coreshell,
        "coreshell",
      );
    },
  };
}
