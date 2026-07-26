// Automated validation for the Drones sub-item `prism-escort`.
//
// A Prism flies in escorted by two Shards, one cyan and one magenta, entering
// alongside it. A real stage is started (its wave kept) and stepped just enough to
// release the first group — the Prism's escort group — and the entering drones are
// read from snapshot().

import { startStageClean } from "../_helpers.mjs";

export default function item() {
  // The field at the instant the first group is airborne.
  let snap;

  return {
    id: "drones.prism-escort",

    // A real stage-1 wave with the wave the game itself builds — the escort grouping
    // is the thing under test, so nothing here may be posed by hand.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
    },

    async act(api) {
      // Release the first group (the Prism + its escorts) but no later group (the
      // next launches at ~0.6s), so what is read is one group and not a mixture.
      await api.advance(24); // 24 ticks = the old 0.2 s
      snap = await api.snapshot();

      // Let the entrance play on so the clip actually shows the Prism and its two
      // escorts flying in together, which is the thing a reviewer is being asked to
      // recognise. The snapshot above is already captured.
      await api.advance(192); // 192 ticks = the old 1600 ms
    },

    async assert(api, check) {
      const entering = snap.drones.filter((d) => d.phase === "entering");
      const prisms = entering.filter((d) => d.kind === "prism");
      const shards = entering.filter((d) => d.kind === "shard");
      check.expectGt("a Prism is flying in", prisms.length, 0);
      check.expectGe("at least two Shards fly in with it", shards.length, 2);
      const bands = new Set(shards.map((d) => d.band));
      check.expectOk("the escorts include a cyan Shard", bands.has("cyan"));
      check.expectOk(
        "the escorts include a magenta Shard",
        bands.has("magenta"),
      );
    },
  };
}
