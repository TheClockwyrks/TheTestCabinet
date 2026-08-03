// Automated validation for the Screen-wrap item `saucer`: the saucer crossing an edge
// reappears at the opposite edge carrying the same velocity. It is also where the case
// grades one half of the `setSaucer` contract, because this is the item that genuinely
// needs it.
//
// The drive asks the saucer to fly the OPPOSITE way from the one it entered on, steps a
// single tick to let the build's own steering answer, and then reads back what it actually
// got. That reading does two jobs. It is asserted directly — `specs/instrumentation.md`
// says `setSaucer` may set `vx`, so a heading given to it has to survive the next step, and
// a build that recomputes its saucer's velocity from the edge it entered by has not
// implemented the operation. And it decides which seam this item then watches: the saucer
// is posed a run-up back from whichever edge its ACTUAL velocity is carrying it toward, so
// the crossing is short and certain on every build. Posing a heading and assuming it took
// is what used to happen, and on a build that discarded it the saucer spent the whole
// budget sailing away from the edge the sweep was waiting at — reported as "the saucer
// never wrapped", which was true and told nobody anything.
//
// The speed asked for is the spec's own 140 px/s, not something brisker, so a build that
// normalizes its saucer's cruise has nothing to disagree with and only the DIRECTION is
// being asked for.
//
// Posing the body a run-up back from the edge is instant (`arrange`); crossing the seam is
// the behavior (`act`), so the clip is the wrap itself. The run-up and the dwell on the far
// side are both sized for that clip: a body posed ON the seam has already crossed it before
// the record pass has painted a frame, and one that cuts on the frame it reappears shows
// nothing either. At the spec cruise this is about two seconds in and a second out, which is
// a crossing a reviewer can actually watch. The verdict is untouched: the `before`/`after`
// pair straddles the seam and the validate pass steps instantly.
//
// `actWrapAcross` ticks one at a time and keeps the previous sample because the wrap is a
// discontinuity BETWEEN two consecutive states — a coarse poll would step over the seam and
// lose the "before".

import {
  newGame,
  actWrapAcross,
  FIELD_W,
  SAUCER_CRUISE,
  ticks,
} from "../_helpers.mjs";

const LANE_Y = 120; // clear of the star, so the avoidance steer never fires
const RUNUP = 300; // px back from the seam: ~2.1 s of approach at the spec cruise

export default function item() {
  // What the build did with the heading it was given, which way it ended up going, and
  // the body either side of the wrap — all read by `assert`.
  let asked;
  let got;
  let dir;
  let outcome;

  return {
    id: "wrap.saucer",

    async arrange(api) {
      await newGame(api);
      await api.call("spawnSaucer");

      // Ask for the opposite of however it entered, so the request is always one the
      // build has to act on rather than one it already agreed with.
      const entered = (await api.snapshot()).saucer?.vx ?? 0;
      asked = entered >= 0 ? -SAUCER_CRUISE : SAUCER_CRUISE;
      await api.call("setSaucer", { y: LANE_Y, vx: asked, vy: 0 });

      // One real step, so what is read back is the saucer the build actually flies and
      // not the value just handed to it. `skip` rather than `advance`: instant in BOTH
      // passes, so this stays a precondition and never becomes part of the clip.
      await api.skip(1);
      got = (await api.snapshot()).saucer?.vx ?? 0;

      // Stand it off the edge its own heading is carrying it toward.
      dir = Math.sign(got) || 1;
      await api.call("setSaucer", {
        x: dir > 0 ? FIELD_W - RUNUP : RUNUP,
        y: LANE_Y,
        vy: 0,
      });
    },

    async act(api) {
      outcome = await actWrapAcross(api, (s) => s.saucer, {
        dir,
        maxTicks: ticks(5),
        dwell: 120, // 1 s on the far side, so the re-entry is watchable
      });
    },

    async assert(api, check) {
      const { before, after, wrapped, lost } = outcome;

      // The control-op half: a heading given to `setSaucer` is the saucer's heading.
      check.expectClose(
        "the heading setSaucer was given survives the next step",
        got,
        asked,
        20,
      );

      check.expectOk("the saucer is still on the field to wrap", !lost);
      check.expectOk(
        "the saucer crossed the edge it was heading for and re-entered on the far side",
        wrapped,
      );
      check.expectLt(
        "it was near that edge before wrapping",
        dir > 0 ? FIELD_W - before.x : before.x,
        80,
      );
      check.expectLt(
        "it reappeared at the opposite edge",
        dir > 0 ? (after?.x ?? FIELD_W) : FIELD_W - (after?.x ?? 0),
        60,
      );
      check.expectClose(
        "it carries the same horizontal velocity across the wrap",
        after?.vx ?? 0,
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
        after?.y ?? -1,
        before.y,
        5,
      );
    },
  };
}
