// Automated validation for the Screen-wrap item `bullet`: a bullet crossing an edge
// reappears at the opposite edge carrying the same velocity. A real bullet is placed at
// the right edge (far from the star, so gravity is negligible over the wrap) moving
// right; the sim is stepped until it wraps and its state before/after is compared.
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
    id: "wrap.bullet",

    async arrange(api) {
      await newGame(api);
      await api.call("addBullet", { x: 900, y: 120, vx: 520, vy: 0 });
    },

    async act(api) {
      outcome = await actWrapAcross(api, (s) => s.bullets[0]);
    },

    async assert(api, check) {
      const { before, after, wrapped } = outcome;

      check.expectOk(
        "the bullet crossed the right edge and re-entered on the left",
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
        4,
      );
      check.expectClose(
        "its vertical velocity is unchanged across the wrap",
        after.vy,
        before.vy,
        4,
      );
    },
  };
}
