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
// A tick that covers less than half a step is a STALLED tick.
const STEP_STALL_FRACTION = 0.5;

// AND WHY IT IS JUDGED AGAINST THE BUILD'S OWN SWIMMING, NOT AN ABSOLUTE FLOOR. This
// used to fail if ANY tick between the start of the approach and the far side fell under
// half a step. That made the item a general movement check wearing the tunnel's name: the
// approach is ordinary corridor, and a build that hitches for a single tick as it passes
// each tile CENTER — everywhere in the maze, nowhere near the tunnel — was failed under
// "nothing stops at the edge" for something the edge had no part in. A run did exactly
// that: its wrap was textbook (the folded crossing step was one clean `128 px/s` step, on
// the same row, inside the frame) and the item still went red, over two stalled ticks in
// the approach at tile centers the forager had to pass either way.
//
// So the seam is compared with the SAME BUILD's ordinary travel a moment earlier. A hitch
// it shows everywhere is not the edge stopping it; a hitch it shows only at the edge is.
// Both halves of the spec's sentence are asked this way: the stall the seam introduces
// (movement is continuous) and the pace it holds across it (speed is continuous).
//
// A single stalled tick is never a stop, however the approach reads. One tick is `1/120 s`
// — under a hundredth of a second, and less ground than the forager's own sprite is wide.
// Requiring the seam to be no worse than an approach that happened to cross no tile center
// at all would fail a build for one frame of hesitation, which is not what "stops at the
// edge" means to anyone watching it.
const SEAM_STALL_GRACE = 1;

// How much slower the crossing may run than the ordinary swimming it is compared against.
// The two windows cover different numbers of tile centers (the approach is as long as the
// maze offered, the seam is the two mouth tiles), so a build with a per-center hitch has a
// slightly different mean in each; this is room for that, not for a build that drags
// through the wrap. Anything that genuinely labors at the seam loses far more.
const SEAM_PACE_FRACTION = 0.85;

/**
 * The longest run of consecutive stalled ticks in `steps`, and the mean ground covered
 * per tick — the two readings the seam and the ordinary approach are compared on.
 */
function pace(steps, stall) {
  let worstRun = 0;
  let run = 0;
  let total = 0;
  for (const step of steps) {
    total += step;
    run = step < stall ? run + 1 : 0;
    worstRun = Math.max(worstRun, run);
  }
  return { stallRun: worstRun, mean: steps.length ? total / steps.length : 0 };
}

export default function item() {
  let wr;
  let grid;
  let budget;
  let wrapped = false;
  let after;
  let strayed = 0;
  let maxStep = 0;
  // Every tick's folded step, split by where the forager was standing when it covered
  // it: ordinary corridor on the way in, or one of the two mouth tiles the wrap joins.
  const approachSteps = [];
  const seamSteps = [];

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
      // hands over on — plus one more tile, because the crossing is not over when the far
      // mouth is reached. The forager still has to swim that tile, and how it does is as
      // much a part of "continuous through the wrap" as the handover itself.
      const perTile = Math.ceil((grid.tile / FORAGER_SPEED) * TICK_HZ);
      budget = (approach + 3) * perTile;
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
        // A tick belongs to the seam if the forager was on either mouth tile at either
        // end of it — which covers the handover itself, since the tick that leaves the
        // left mouth is the tick that arrives at the right one.
        const atMouth = (t) => t.tx === 0 || t.tx === grid.cols - 1;
        if (underway) {
          maxStep = Math.max(maxStep, step);
          (atMouth(prev) || atMouth(f) ? seamSteps : approachSteps).push(step);
        }
        prev = f;
        strayed = Math.max(strayed, left - f.x, f.x - right);
        if (!wrapped && f.tx > grid.cols - 3) {
          wrapped = true;
          after = f; // the state it came out in, not wherever the sweep ends
        }
        // Clear of the far mouth: the wrap is behind it and this is ordinary corridor
        // again, so there is nothing left for this item to read.
        if (wrapped && f.tx < grid.cols - 1) break;
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
      const stall = step * STEP_STALL_FRACTION;
      const seam = pace(seamSteps, stall);
      const ordinary = pace(approachSteps, stall);
      check.expectLe(
        "nothing stops at the edge that does not stop everywhere",
        seam.stallRun,
        Math.max(ordinary.stallRun, SEAM_STALL_GRACE),
      );
      check.expectGe(
        "it crosses the seam at the pace it swims the corridor",
        seam.mean,
        ordinary.mean * SEAM_PACE_FRACTION,
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
