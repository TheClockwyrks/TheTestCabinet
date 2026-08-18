// gloamfin.corners-slow: a corner the chasing Gloamfin turns drops it below the
// forager's speed before it ramps back up.
//
// The corner is posed instantly (`arrange`); the sampling sweep across the turn is the
// measurement itself, so it is `act` and is what the clip shows.
import {
  FORAGER_SPEED,
  findCorner,
  isOpen,
  pred,
  quietBoard,
  startPlaying,
  stepTile,
} from "../_helpers.mjs";

export default function item() {
  let firstState = null;
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
      //
      // AS FAR DOWN THAT ARM AS IT RUNS, up to three tiles. The corner floor is not the
      // turn itself but the ramp back up out of it — "it drops to about `115 px/s` ... and
      // then ramps back up to the `134` cap over about `2 s`" (specs/predators.md) — and
      // with the forager parked one tile past the junction the Gloamfin arrives before any
      // of that is visible. It reads a dip in one or two samples and the clip shows a
      // hunter turning a corner and immediately arriving, which is not the behaviour the
      // item is named for. Three tiles of arm gives the ramp somewhere to happen.
      let stand = c.perpTile;
      for (let i = 0; i < 2; i++) {
        const [nc, nr] = stepTile(snap, stand.tx, stand.ty, c.perp);
        if (!isOpen(snap.tiles, nc, nr)) break;
        stand = { tx: nc, ty: nr };
      }
      // The forager first, and PARKED: `chase` fixes on wherever it is standing when the
      // mode is set, and the corner it must round is the one between them.
      await quietBoard(api, stand);
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
      // contract refuses to round it. 4 ticks rounds the sampling cadence UP, so a sample
      // cannot miss the corner floor this is looking for; 3 would shorten the window
      // instead. 72 samples span 2.4 s: the run in, the turn, and the whole ~2 s ramp back
      // to the cap that the extra corridor above exists to make visible.
      for (let i = 0; i < 72; i++) {
        await api.advance(4);
        const s = await api.snapshot();
        if (s.screen !== "playing") break;
        const g = pred(s, "gloamfin");
        if (firstState === null) firstState = g.state;
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
      // Named separately from `sawChase` so a build that drops the fix the instant it is
      // posed — never chasing at all, so never cornering — reports THAT rather than the
      // cornering verdict it never got far enough to earn. `setPredator(…, "chase")` is
      // defined as fixed on the forager's tile and pursuing (specs/instrumentation.md),
      // and the forager is standing on that tile, so a conforming Gloamfin has nothing to
      // have lost.
      check.expectEq(
        "the Gloamfin holds the fix it was posed with",
        firstState,
        "chase",
      );
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
