// Automated validation for the overload variant's Mode sub-item `mode.prism-overload`.
//
// A Prism whose exposed shell is driven to overload emits a two-band burst (one
// cyan, one magenta) and spawns one extra Shard escort. A Prism is posed with its
// shell intact, brought to the brink (setDroneCharge), and tipped over by a real
// mismatched shell hit; the real overload fires the burst and grows the swarm, read
// back from snapshot().

import {
  startClean,
  spawnDrone,
  findDrone,
  shootDrone,
  enemyBullets,
} from "../_helpers.mjs";

export default function item() {
  // The Prism, the swarm size before the overload, and the field after it.
  let prismId;
  let before;
  let snap;

  return {
    id: "mode.prism-overload",

    // One Prism, shell intact and posed one charge short, so a single real
    // mismatched shell hit tips it. The swarm size is read here so the growth the
    // overload causes is measured against the field as it stood beforehand.
    async arrange(api) {
      await startClean(api);
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan", // magenta is the wrong band on the shell
        x: 640,
        y: 300,
        phase: "formation",
      });
      await api.call("setDroneCharge", prismId, 2);
      before = (await api.snapshot()).drones.length;
    },

    async act(api) {
      await shootDrone(api, prismId, "magenta"); // wrong band on the shell -> charges, then overloads
      await api.advance(12); // 12 ticks = the old 0.1 s for the overload to resolve
      snap = await api.snapshot();

      // Let the burst spread and the new escort take up station, so the clip shows
      // both halves of the reaction the assertions check.
      await api.advance(144); // 144 ticks = the old 1200 ms
    },

    async assert(api, check) {
      const enemies = enemyBullets(snap);
      const bands = new Set(enemies.map((b) => b.band));
      check.expectOk("the overload fires a cyan bullet", bands.has("cyan"));
      check.expectOk(
        "the overload fires a magenta bullet",
        bands.has("magenta"),
      );
      check.expectGt(
        "the overload spawns an extra escort (the swarm grows)",
        snap.drones.length,
        before,
      );
      const prism = findDrone(snap, prismId);
      check.expectOk(
        "the Prism itself survives the overload",
        prism !== null && prism.shellAlive === true,
      );
      check.expectOk(
        "the new drone is a Shard escort",
        snap.drones.some((d) => d.id !== prismId && d.kind === "shard"),
      );
    },
  };
}
