// amber.drifter-score: eating a bonus drifter scores 200.
//
// Entering play and standing the forager at the head of a corridor with a drifter a few
// tiles along it is instant (`arrange`); swimming into the drifter is the real sim, so it
// is `act` — the clip shows the forager cross the gap and take it.
//
// WHY IT SWIMS RATHER THAN BEING HANDED ONE. The drifter used to be spawned on the
// forager's own tile and eaten on the next tick, which decides the same thing but films
// nothing: the clip opened on a score that had already changed. It also had to strip the
// board to a last plankton first, so that the 200 was the only thing that could have
// scored — and a forager that then moves at all on a stripped board clears the maze. Both
// go away by accounting for the plankton instead: the forager grazes the corridor on its
// way to the drifter, and what the drifter paid is the score rise LESS the pellets that
// rise came with. The board stays full, so nothing can clear out from under the swim.
//
// WHY THE DRIFTER IS HELD STILL. A drifter wanders on its own, at half the forager's
// pace but with the whole maze to wander into — and the first thing it did on a real
// build was turn down a side corridor off the run and never come back, so a forager
// swimming the straight line it was posted on never met it and the item failed a build
// that scores drifters perfectly well. Chasing it instead would only trade that for a
// different gamble, on a maze the build invented. `setCreatureAI(false)` is the op that
// removes the gamble (specs/instrumentation.md): the drifter stays exactly where it was
// spawned, and everything the item actually measures — the forager swimming, the pellets
// it grazes, the drifter being eaten, the 200 it pays — runs untouched.
import {
  DIR_KEY,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  TICK,
  denAllExcept,
  findStraightRun,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let run;
  let before;
  let eaten;

  return {
    id: "amber.drifter-score",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, []); // den every predator so none disturbs the run-up
      await api.call("setCreatureAI", false); // the drifter waits where it is put
      // Four tiles: the forager at one end and the drifter three along, a gap it crosses
      // in about 0.75 s — long enough to watch, short enough to be the clip.
      run = findStraightRun(snap, 4);
      const [dc, dr] = { right: [1, 0], down: [0, 1] }[run.dir];
      await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
      await api.call("spawnDrifter", {
        tx: run.tx + dc * 3,
        ty: run.ty + dr * 3,
      });
    },

    async act(api) {
      before = await api.snapshot();
      await api.call("keyDown", DIR_KEY[run.dir]);
      eaten = await api.until(
        (s) => s.drifters.length < before.drifters.length,
        {
          max: ticksFor(3),
          poll: TICK,
        },
      );
      await api.call("keyUp", DIR_KEY[run.dir]);
      await api.advance(60); // 0.5 s tail
    },

    async assert(api, check) {
      check.expectOk("the forager swam into the drifter", eaten.hit);
      if (!eaten.hit) return;
      const grazed = before.planktonRemaining - eaten.snap.planktonRemaining;
      check.expectEq(
        "eating a drifter scores 200 (over and above the plankton grazed on the way)",
        eaten.snap.score - before.score - grazed * SCORE_PLANKTON,
        SCORE_DRIFTER,
      );
    },
  };
}
