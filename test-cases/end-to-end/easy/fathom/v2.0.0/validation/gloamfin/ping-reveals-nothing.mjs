// gloamfin.ping-reveals-nothing: its own ping reveals no terrain (only its violet
// wavefront is visible) and it does not draw itself.
//
// The lone Gloamfin is posed instantly (`arrange`); the sweep that waits for its ping to
// be well in flight is `act`, and is what the clip shows.
import { startPlaying, denAllExcept, findFarTile, pred } from "../_helpers.mjs";

// Tiles revealed FAR from the forager (beyond the reach of the local passive light) —
// any such revealed tile would have to come from something other than the light.
function farRevealed(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      const v = s.visibility[r][c];
      if (
        (v === "l" || v === "r") &&
        Math.abs(c - s.forager.tx) + Math.abs(r - s.forager.ty) > 5
      ) {
        n++;
      }
    }
  }
  return n;
}

export default function item() {
  let r;

  return {
    id: "gloamfin.ping-reveals-nothing",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 11); // beyond its ping range, so no acquire
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      // Advance until the Gloamfin's ping is well in flight. 1200 ticks = the old loop's
      // 200 passes of 0.05 s (10 s); poll 6 = that same 0.05 s chunk.
      r = await api.until(
        (s) => s.pulses.some((p) => p.source === "gloamfin" && p.front > 2),
        { max: 1200, poll: 6 },
      );
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Gloamfin emitted a violet ping wavefront", r.hit);
      check.expectEq(
        "its ping reveals no terrain out in the dark",
        farRevealed(r.snap),
        0,
      );
      check.expectOk(
        "it does not draw itself (unlit in the fog)",
        pred(r.snap, "gloamfin").lit === false,
      );
    },
  };
}
