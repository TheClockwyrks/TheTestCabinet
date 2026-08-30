// Automated validation for world-size.scales-depth.
//
// Quick, Standard, and Marathon scale how deep the Core is (roughly half, reference, and double
// depth). We start an expedition at each size and read the Core chamber's row through findTile.

export default function item() {
  let quick;
  let standard;
  let marathon;

  return {
    id: "world-size.scales-depth",

    // Generating each size and locating its Core is instant (reset, startExpedition, and findTile
    // all consume no simulation time), so all three belong here — `act` may not reset.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "quick");
      quick = await api.call("findTile", "core");

      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "standard");
      standard = await api.call("findTile", "core");

      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "marathon");
      marathon = await api.call("findTile", "core");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own.
    async act(api) {
      await api.settle(150);
      await api.screenshot("depths");
    },

    async assert(api, check) {
      check.expectEq(
        "Quick is a half-depth mine",
        quick ? quick.row : null,
        250,
      );
      check.expectEq(
        "Standard is the reference depth",
        standard ? standard.row : null,
        500,
      );
      check.expectEq(
        "Marathon is a double-depth mine",
        marathon ? marathon.row : null,
        1000,
      );
    },
  };
}
