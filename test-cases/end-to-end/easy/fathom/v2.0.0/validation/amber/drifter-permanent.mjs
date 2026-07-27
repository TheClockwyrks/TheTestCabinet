// amber.drifter-permanent: a drifter persists (does not fade) until eaten.
//
// Spawning the drifter is instant (`arrange`); the long stretch of time it has to
// survive IS the check, so it is `act` and is what the clip shows.
import {
  denAllExcept,
  findFarTile,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let n0;
  let n1;

  return {
    id: "amber.drifter-permanent",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, []); // den all predators so none disturbs the scene
      const far = findFarTile(snap, snap.forager, 10); // far from the stationary forager, so it is not eaten
      await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
      await quietBoard(api);
    },

    async act(api) {
      n0 = (await api.snapshot()).drifters.length;
      await api.advance(960); // 960 ticks = the old step(8): a long stretch of time
      n1 = (await api.snapshot()).drifters.length;
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectGt("the drifter spawned", n0, 0);
      check.expectGe(
        "the drifter still exists after time passes (it does not fade)",
        n1,
        n0,
      );
    },
  };
}
