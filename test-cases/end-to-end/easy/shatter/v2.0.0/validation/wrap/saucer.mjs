// Automated validation for the Screen-wrap item `saucer`: the saucer crossing an edge
// reappears at the opposite edge carrying the same velocity. A saucer is posed at the
// right edge (clear of the star, so its avoidance never fires) moving right; the sim is
// stepped until it wraps and its state before/after is compared.
//
// Posing the body at the right edge is instant (`arrange`); crossing the seam is the behavior
// (`act`), so the clip is the wrap itself. `actWrapAcross` ticks one at a time and keeps the
// previous sample because the wrap is a discontinuity BETWEEN two consecutive states — a coarse
// poll would step over the seam and lose the "before". Its default budget of 400 ticks is the
// old `maxSteps: 400`, which was already a fixed-step count, so it is the same amount of time.
//
// The body is posed a good way BACK from the edge, not on it. The record pass films `act`,
// and a body posed on the seam has already crossed it before the recording has painted a
// frame — the clip then shows the arrange state sitting still and nothing else. Running it in
// from a few hundred px away, and on across the far side afterwards (`actWrapAcross`'s
// dwell), is what makes the crossing something a reviewer can see. The verdict is untouched:
// the `before`/`after` pair straddles the seam either way, and the validate pass steps
// instantly.
import { newGame, actWrapAcross } from "../_helpers.mjs";

export default function item() {
  // The body just before and just after the wrap, read by `assert`.
  let outcome;

  return {
    id: "wrap.saucer",

    async arrange(api) {
      await newGame(api);
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 900, y: 120, vx: 300, vy: 0 });
    },

    async act(api) {
      outcome = await actWrapAcross(api, (s) => s.saucer);
    },

    async assert(api, check) {
      const { before, after, wrapped } = outcome;

      check.expectOk(
        "the saucer crossed the right edge and re-entered on the left",
        wrapped,
      );
      check.expectGt(
        "it was near the right edge before wrapping",
        before.x,
        1200,
      );
      check.expectLt("it reappeared at the left edge", after.x, 60);
      check.expectClose(
        "it carries the same horizontal velocity across the wrap",
        after.vx,
        before.vx,
        2,
      );
      // The saucer's HEIGHT carries across the seam, rather than its vertical
      // velocity. Wrapping in x must not move a body in y, which is what this reads.
      // Pinning `vy` instead would be asserting something the spec does not say: the
      // saucer is a powered craft that "chang[es] its vertical direction every second
      // or so to weave" (`specs/hazards.md`), so it is entitled to turn on any tick,
      // including whichever one it happens to cross the edge on.
      check.expectClose(
        "it keeps its height across the wrap",
        after.y,
        before.y,
        5,
      );
    },
  };
}
