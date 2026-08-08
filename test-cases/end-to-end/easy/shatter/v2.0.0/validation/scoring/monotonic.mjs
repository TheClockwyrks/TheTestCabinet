// Automated validation for the Scoring item `monotonic`: over a driven kill sequence the HUD
// score only ever rises. Three Small rocks are destroyed one after another and the score is
// sampled after each, so it must climb strictly through 100, 200, 300.
//
// All three rocks are posed UP FRONT, spaced apart, and a fourth rock is parked out of the way
// as a bystander that is never shot. Both parts of that are there to keep the game's own wave
// machinery out of a measurement it would otherwise dominate.
//
// The sequence used to pose one rock, kill it, pose the next, and so on. Every one of those
// kills emptied the field, which clears the wave (`specs/gameplay.md`), which spawns the next
// one — five Large rocks at random positions, drifting. The run then had wave rocks wandering
// across the lanes the remaining shots flew down, and a bullet that struck one of THEM scored
// a Large or a Medium on top of the Small it was aimed at. That is exactly what happened: a
// sequence that should have read 100, 200, 300 read 100, 490, 590 — still monotonic, so the
// three "the score rises" assertions all passed, and only the total caught it. Posing the
// three at once and keeping a bystander alive means the field never empties, so no wave ever
// arrives and the only things that can be shot are the three rocks this item put there.
//
// Each rock gets its own lane and its own shot, `actFireOneShotAt` aiming at a known position
// rather than at "whichever Small is nearest" — with three of them on the field at once, the
// shot has to say which one it means. A Small is a one-hit kill in both variants.
//
// Posing is instant (`arrange`); the three kills are the behavior under test (`act`), so the
// clip is the run of kills whose scores the check reads.

import {
  newGame,
  arrangeBystanderRock,
  actFireOneShotAt,
  ROCK_SCORE,
} from "../_helpers.mjs";

// Three well-separated targets, each on its own left-to-right lane and none of them near
// enough to the star for the well to pull a shot off line or swallow it.
const TARGETS = [
  { x: 420, y: 170 },
  { x: 540, y: 250 },
  { x: 460, y: 560 },
];

export default function item() {
  // The score after each of the three kills, and the final field, read by `assert`.
  let scores;
  let field;

  return {
    id: "scoring.monotonic",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      for (const t of TARGETS) {
        await api.call("addRock", "small", { ...t, vx: 0, vy: 0 });
      }
      await arrangeBystanderRock(api);
    },

    async act(api) {
      scores = [];
      for (const t of TARGETS) {
        // A short dwell per kill: three run back to back and the clip should be the
        // sequence, not three long holds on an already-dead rock.
        await actFireOneShotAt(api, t, { dwell: 24 });
        scores.push((await api.snapshot()).score);
      }
      field = await api.snapshot();
      await api.advance(90); // 0.75 s tail, so the clip ends on the final score
    },

    async assert(api, check) {
      check.expectEq("the first kill scores 100", scores[0], ROCK_SCORE.small);
      check.expectGt(
        "the score rises on the second kill",
        scores[1],
        scores[0],
      );
      check.expectGt(
        "the score rises again on the third kill",
        scores[2],
        scores[1],
      );
      check.expectEq(
        "three Small kills total 300",
        scores[2],
        3 * ROCK_SCORE.small,
      );
      // If a wave had arrived mid-sequence, the score above would have been paid by
      // rocks this item never posed. It cannot have: the bystander kept the field
      // occupied throughout, and here it still is.
      check.expectEq(
        "only the untouched bystander is left, so no wave arrived mid-sequence",
        field.rocks.length,
        1,
      );
    },
  };
}
