// gloamfin.corners-slow: a corner the chasing Gloamfin turns drops it below the
// forager's speed before it ramps back up.
//
// The corner is posed instantly (`arrange`); the sampling sweep across the turn is the
// measurement itself, so it is `act` and is what the clip shows.
import {
  FORAGER_SPEED,
  findCorner,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let sawBelow = false;
  let minSpeed = Infinity;

  return {
    id: "gloamfin.corners-slow",

    async arrange(api) {
      const snap = await startPlaying(api);
      const c = findCorner(snap);
      // Forager on the perpendicular arm; Gloamfin on the approach arm, chasing — its path
      // to the forager turns a perpendicular corner at the junction.
      // The forager first, and PARKED: `chase` fixes on wherever it is standing when the
      // mode is set, and the corner it must round is the one between them.
      await quietBoard(api, c.perpTile);
      await api.call("setPredator", "gloamfin", {
        tx: c.back.tx,
        ty: c.back.ty,
        mode: "chase",
      });
    },

    async act(api) {
      // The old loop sampled every 0.03 s, which is 3.6 ticks — not a whole tick, and the
      // contract refuses to round it. 4 ticks rounds the sampling cadence UP, so 40
      // samples still span the whole turn (1.33 s rather than 1.2 s) and cannot miss the
      // corner floor this is looking for; 3 would shorten the window instead.
      for (let i = 0; i < 40; i++) {
        await api.advance(4);
        const s = await api.snapshot();
        if (s.screen !== "playing") break;
        const g = pred(s, "gloamfin");
        minSpeed = Math.min(minSpeed, g.speed);
        if (g.speed < FORAGER_SPEED) sawBelow = true;
      }
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "cornering drops the Gloamfin below the forager's 128 px/s",
        sawBelow,
      );
      check.expectLt(
        "the corner floor is below the forager's speed",
        minSpeed,
        FORAGER_SPEED,
      );
    },
  };
}
