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
  let sawChase = false;
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
        // Facing along the approach arm, INTO the junction (`dir` is part of
        // `setPredator`, specs/instrumentation.md). Without it the Gloamfin is posed on
        // the approach tile still carrying whatever heading it happened to have — which
        // may point into rock — so what the sweep then measures depends on how a build
        // resolves a chase begun facing a wall rather than on what it does at a corner.
        // Pointed at the junction, the only route to the fix is straight in and a
        // perpendicular turn out, which is exactly the manoeuvre this item is about.
        dir: c.approach,
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
        // Only what it does WHILE CHASING counts. The corner floor is a property of the
        // chase ramp — "`134 px/s` is only a cap ... the instant the Gloamfin turns a
        // corner ... it drops to about `115 px/s`" (specs/predators.md) — while its
        // ordinary wander is a flat `116 px/s`, already under the forager's `128`. A
        // sweep that counted any state would take a Gloamfin that simply gave up and
        // went back to wandering as evidence of cornering, and pass a build with no
        // ramp at all.
        if (g.state !== "chase") continue;
        sawChase = true;
        minSpeed = Math.min(minSpeed, g.speed);
        if (g.speed < FORAGER_SPEED) sawBelow = true;
      }
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Gloamfin chased through the corner", sawChase);
      if (!sawChase) return;
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
