// flarefish.flare-reveals: the flare reveals a radial disc of tiles (floor and wall)
// to the player, through walls.
//
// The Flarefish is posed out in the dark instantly (`arrange`); the wait for its bloom is
// the behavior under test, so it is `act` and is what the clip opens on.
import { startPlaying, denAllExcept, findFarTile, pred } from "../_helpers.mjs";

function revealedNear(s, tx, ty, rad) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (Math.abs(c - tx) + Math.abs(r - ty) > rad) continue;
      const v = s.visibility[r][c];
      if (v === "l" || v === "r") n++;
    }
  }
  return n;
}

export default function item() {
  let far;
  let before;
  let r;
  let after;

  return {
    id: "flarefish.flare-reveals",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      far = findFarTile(snap, snap.forager, 9); // in an unrevealed region far from the light
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      before = revealedNear(await api.snapshot(), far.tx, far.ty, 4);
      // 1140 ticks = the old 9.5 s cap; poll 12 = the old 0.1 s chunk.
      r = await api.until((s) => pred(s, "flarefish").flaring === true, {
        max: 1140,
        poll: 12,
      });
      const fx = pred(r.snap, "flarefish");
      after = revealedNear(r.snap, fx.tx, fx.ty, 4);
      await api.advance(120); // 120 ticks = the old 1000 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Flarefish flares", r.hit);
      check.expectGt(
        "the flare reveals a disc of tiles around the Flarefish",
        after,
        before,
      );
    },
  };
}
