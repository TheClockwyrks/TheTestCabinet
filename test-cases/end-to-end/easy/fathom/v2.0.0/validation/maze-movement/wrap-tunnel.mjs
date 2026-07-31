// maze-movement.wrap-tunnel: travelling into the wrap tunnel carries the forager
// continuously out the opposite edge.
//
// Locating the tunnel row and standing in its left arm is instant (`arrange`); swimming
// into the mouth and out the far side is the real sim, so it is `act` — the clip is the
// approach and the wrap itself.
//
// WHY IT STARTS INSIDE THE CORRIDOR, NOT ON THE MOUTH TILE. An earlier form posed the
// forager AT the border tile (`tx: 0`) at rest and then pressed left, so the wrap had to
// engage from a standing start on the seam itself. That is a different requirement from
// the one this item names — "travelling into the horizontal wrap tunnel carries the
// forager continuously out the opposite edge" — and it is the harder half of the
// turn-at-center rule (`specs/movement.md`: a stopped forager turns into a direction that
// "leads into an open tile", which on the mouth tile means resolving the far mouth as
// that neighbor). A build that wraps a MOVING forager perfectly, exactly as the spec's
// tunnel demands, could sit motionless on the mouth tile forever and fail this item for a
// reason it is not about. So the forager now starts in the corridor a tile or two inside
// the mouth and swims INTO the tunnel: the crossing is a continuation of travel already
// under way, which is the property `specs/maze.md` fixes ("movement and speed are
// continuous through the wrap; nothing stops at the edge").
//
// WHY IT WAITS RATHER THAN SAMPLING. An earlier form advanced a flat 18 ticks and then
// asserted the forager had already come out the far side. That pinned the check to one
// particular seam: a build that hands over a few pixels later failed while wrapping
// perfectly well. The spec fixes the TOPOLOGY (the two mouths are one corridor, and
// nothing stops at the edge), not the pixel the swap happens on, so this waits for the
// crossing over a budget big enough for any sane seam and checks the properties the spec
// does name.
import {
  FORAGER_SPEED,
  TICK_HZ,
  isOpen,
  startPlaying,
  unmetPrecondition,
  wrapRow,
} from "../_helpers.mjs";

// How far inside the mouth to start, in tiles. One tile is enough to be under way at the
// seam; two is preferred so the clip opens on a moment of ordinary swimming before the
// wrap. More than that only lengthens the clip — and the interior path beyond the mouth
// "need not be a single straight open row" (specs/maze.md), so a long straight approach
// is not something a conforming maze owes this check.
const MAX_APPROACH = 2;

// How far outside the maze frame the forager's center may stray while crossing. The
// border is where the two mouths meet, so a wrap should not park the forager out in the
// margin; a few sim steps of overshoot is slack for the fixed timestep, not a design.
const EDGE_SLACK = (4 * FORAGER_SPEED) / TICK_HZ; // 4 steps ≈ 4.3 px

// HOW "nothing stops at the edge" IS MEASURED. Not from the snapshot's `moving` flag:
// that is a build's own bookkeeping, and a forager plainly still travelling can read
// false for a tick without anything having stopped. What the spec fixes is the motion
// itself — "movement and speed are continuous through the wrap" (specs/maze.md) — so
// this measures the ground the forager actually covers per tick across the seam, with
// the wrap folded out (a crossing tick reads as one step, not as a jump the width of the
// maze). A conforming wrap maps a position to the same point on the far side, so every
// tick of the crossing covers the same `128 px/s` step as any other tick of swimming.
//
// The band around that step is deliberately lopsided. Below it there is nothing to
// forgive: a tick that covers less than half a step is a stall at the edge, which is
// what the spec forbids. Above it, one tick may legitimately carry a little extra — a
// build is free to choose WHERE the two mouths meet (at the frame border, at the tile
// centers, when the sprite has fully left), and a seam placed differently shows up as a
// single tick that gains up to half a tile once. Gaining a WHOLE tile is not a seam
// offset: it means the forager never swam the mouth tiles at all but was snapped from
// one center to the other, which is the discontinuity this item is about.
const STEP_STALL_FRACTION = 0.5;

export default function item() {
  let wr;
  let grid;
  let budget;
  let wrapped = false;
  let after;
  let strayed = 0;
  let minStep = Infinity;
  let maxStep = 0;

  return {
    id: "maze-movement.wrap-tunnel",

    async arrange(api) {
      const snap = await startPlaying(api);
      wr = wrapRow(snap);
      grid = snap.grid;
      if (wr < 0) return;
      // The corridor running inward from the left mouth, capped at MAX_APPROACH.
      let approach = 0;
      while (approach < MAX_APPROACH && isOpen(snap.tiles, approach + 1, wr)) {
        approach += 1;
      }
      if (approach === 0) {
        // The mouth tile has no open neighbor inland, so nothing can swim into it
        // horizontally — this build's tunnel cannot be entered the way the item
        // describes. A property of the maze it invented, not of its debug API.
        throw unmetPrecondition(
          `the left wrap mouth at row ${wr} has no open corridor tile beside it to swim in from`,
        );
      }
      await api.call("setForager", { tx: approach, ty: wr, dir: "left" });
      // Ticks to cross the approach tiles and the seam, with a tile of slack: far more
      // than the distance between the two mouths, whichever side of the border a build
      // hands over on.
      const perTile = Math.ceil((grid.tile / FORAGER_SPEED) * TICK_HZ);
      budget = (approach + 2) * perTile;
    },

    async act(api) {
      if (wr < 0) return;
      const left = grid.originX;
      const span = grid.cols * grid.tile; // the wrap's period: x and x + span are one point
      const right = left + span;
      await api.call("keyDown", "ArrowLeft");
      let prev = (await api.snapshot()).forager;
      let underway = false;
      for (let i = 0; i < budget; i++) {
        await api.advance(1);
        const f = (await api.snapshot()).forager;
        // Ground covered this tick, with the wrap folded out so the crossing tick reads
        // as a step rather than as a leap the width of the maze.
        let step = prev.x - f.x; // leftward travel is positive
        if (step < -span / 2) step += span;
        else if (step > span / 2) step -= span;
        // Measured only once the forager is actually under way: a build that raises its
        // heading on the tick after the key lands has not stalled at anything, it simply
        // has not started yet.
        if (step > 0) underway = true;
        if (underway) {
          minStep = Math.min(minStep, step);
          maxStep = Math.max(maxStep, step);
        }
        prev = f;
        strayed = Math.max(strayed, left - f.x, f.x - right);
        if (f.tx > grid.cols - 3) {
          wrapped = true;
          after = f;
          break;
        }
      }
      await api.call("keyUp", "ArrowLeft");
      await api.advance(96); // 96 ticks of the key still held, for the clip
    },

    async assert(api, check) {
      check.expectOk("the maze has a horizontal wrap tunnel", wr >= 0);
      if (wr < 0) return;
      check.expectOk(
        "swimming off the left edge carries the forager to the right edge",
        wrapped,
      );
      if (!wrapped) return;
      check.expectEq("it comes out on the same row", after.ty, wr);
      const step = FORAGER_SPEED / TICK_HZ; // px of travel in one tick
      check.expectGe(
        "nothing stops at the edge",
        minStep,
        step * STEP_STALL_FRACTION,
      );
      check.expectLe(
        "it swims through the seam rather than skipping across it",
        maxStep,
        step + grid.tile / 2,
      );
      check.expectLe(
        "the forager stays within the maze frame as it crosses",
        strayed,
        EDGE_SLACK,
      );
    },
  };
}
