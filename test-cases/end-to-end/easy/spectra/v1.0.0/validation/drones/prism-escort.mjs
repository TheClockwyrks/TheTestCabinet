// Automated validation for the Drones sub-item `prism-escort`.
//
// A Prism flies in escorted by two Shards, one cyan and one magenta, entering
// alongside it. A real stage is started (its wave kept) and stepped just enough to
// release the first group — the Prism's escort group — and the entering drones are
// read from snapshot().

import { startStageClean, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.prism-escort");

  await startStageClean(api, 1, { clear: false });
  // Release the first group (the Prism + its escorts) but no later group (the next
  // launches at ~0.6s).
  await api.step(0.2);

  const snap = await api.snapshot();
  const entering = snap.drones.filter((d) => d.phase === "entering");
  const prisms = entering.filter((d) => d.kind === "prism");
  const shards = entering.filter((d) => d.kind === "shard");
  check.expectGt("a Prism is flying in", prisms.length, 0);
  check.expectGe("at least two Shards fly in with it", shards.length, 2);
  const bands = new Set(shards.map((d) => d.band));
  check.expectOk("the escorts include a cyan Shard", bands.has("cyan"));
  check.expectOk("the escorts include a magenta Shard", bands.has("magenta"));

  await clip(api, 1600);
  return check.verdict();
}
