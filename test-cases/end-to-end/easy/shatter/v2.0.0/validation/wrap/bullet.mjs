// Automated validation for the Screen-wrap item `bullet`: a bullet crossing an edge
// reappears at the opposite edge carrying the same velocity. Two crossings are driven, in
// opposite directions and at different heights, because only one of them was being checked
// and the other is where a build can go wrong on its own.
//
// The first is a straight run at the RIGHT edge, high up and far from the star so gravity is
// negligible over the wrap. The second runs the other way, at the LEFT edge, along the star's
// own row.
//
// The row is the point of the second crossing. A wrap moves a body the whole width of the
// field in a single step, so any test a build makes against the PATH between two consecutive
// positions — a swept-segment check for the star core, say, which is a sensible way to stop a
// fast bullet tunnelling through it — sees a line straight across the field unless it is
// written to understand the seam. On the star's row that false line runs through the core, so
// a build with that fault deletes the bullet as absorbed on the very tick it wraps. It is not
// hypothetical: it is what a build did, and every wrap this item used to drive was 200 px
// clear of the row, where the same false line misses the core and the fault is invisible.
//
// The row is used rather than a corner even though a corner shows the same fault more
// dramatically (there the false line is the field's diagonal, which passes through the star
// exactly). A corner crossing only produces that diagonal if both axes cross on the SAME
// tick, and gravity pulls a diagonal shot unequally in x and y, so whether they stay in step
// is an accident of the numbers — measured, one diagonal run wrapped both axes together and
// another, from a different start, wrapped them nine ticks apart and sailed through. A
// crossing on the row does not depend on any of that.
//
// Posing each body a good way BACK from its edge is instant (`arrange` for the first
// crossing, a control op mid-`act` for the second); crossing the seam is the behavior, so the
// clip is the two wraps themselves. `actWrapAcross` ticks one at a time and keeps the
// previous sample because the wrap is a discontinuity BETWEEN two consecutive states — a
// coarse poll would step over the seam and lose the "before". A body posed ON the seam has
// already crossed it before the record pass has painted a frame, which is why each run-up is
// a few hundred px, and why `actWrapAcross` dwells on the far side afterwards. The verdict is
// untouched either way: the `before`/`after` pair straddles the seam, and the validate pass
// steps instantly.

import {
  newGame,
  arrangeBystanderRock,
  actWrapAcross,
  FIELD_W,
  STAR_Y,
  TICK,
  ticks,
} from "../_helpers.mjs";

export default function item() {
  // The body just before and just after each wrap, read by `assert`.
  let straight;
  let onRow;

  return {
    id: "wrap.bullet",

    async arrange(api) {
      await newGame(api);
      // This item drives two crossings back to back and so runs longer than most,
      // which is long enough for the game's OWN next wave to arrive partway through:
      // `newGame` empties the field, that clears the wave, and about a second and a
      // half later five Large rocks are spawned at random positions — one of which
      // intercepted the second shot and destroyed the bullet before it ever reached
      // the seam. A parked rock keeps the field occupied so no wave is ever cleared.
      // It sits in the bottom-left, clear of both lanes this item flies.
      await arrangeBystanderRock(api, { x: 160, y: 690 });
      await api.call("addBullet", { x: 900, y: 120, vx: 520, vy: 0 });
    },

    async act(api) {
      straight = await actWrapAcross(api, (s) => s.bullets[0]);

      // Second crossing, leftward along the star's row. The first round is waited out
      // rather than worked around, so this run has exactly one bullet on the field and
      // `bullets[0]` is unambiguously the one under test. Reading "the newest bullet"
      // instead would be reading an INDEX, and the index of a body is not stable across
      // a build removing an earlier one — the first round expires partway through this
      // run, and the sweep saw the list shift under it.
      await api.until((s) => s.bullets.length === 0, {
        max: ticks(2),
        poll: TICK,
      });
      // Posed to the RIGHT of the left edge and flying away from the star, so the run up
      // to the seam never goes near the core and the only thing that can remove this
      // bullet before it wraps is the wrap itself.
      await api.call("addBullet", { x: 380, y: STAR_Y, vx: -520, vy: 0 });
      onRow = await actWrapAcross(api, (s) => s.bullets[0], { dir: -1 });
    },

    async assert(api, check) {
      check.expectOk(
        "the bullet crossed the right edge and re-entered on the left",
        straight.wrapped,
      );
      check.expectGt(
        "it was near the right edge before wrapping",
        straight.before.x,
        1200,
      );
      check.expectLt("it reappeared at the left edge", straight.after.x, 60);
      check.expectClose(
        "it carries the same horizontal velocity across the wrap",
        straight.after.vx,
        straight.before.vx,
        4,
      );
      check.expectClose(
        "its vertical velocity is unchanged across the wrap",
        straight.after.vy,
        straight.before.vy,
        4,
      );

      // Survival first: a bullet that is GONE has not wrapped badly, it has been
      // destroyed by wrapping, and that is the fault worth naming on its own.
      check.expectOk(
        "a bullet wrapping on the star's row survives — crossing the seam is not a trip through the core",
        !onRow.lost,
      );
      check.expectOk(
        "it crossed the left edge and re-entered on the right",
        onRow.wrapped,
      );
      check.expectLt(
        "it was near the left edge before wrapping",
        onRow.before.x,
        80,
      );
      check.expectGt(
        "it reappeared at the right edge",
        onRow.after?.x ?? -1,
        FIELD_W - 80,
      );
      check.expectClose(
        "it carries its horizontal velocity across that wrap too",
        onRow.after?.vx ?? 0,
        onRow.before.vx,
        6,
      );
      check.expectClose(
        "and it keeps its height across the seam",
        onRow.after?.y ?? -1,
        onRow.before.y,
        5,
      );
    },
  };
}
