// Automated validation for the Growth & Pellets sub-item `pellet-respawn-valid`.
//
// After every eat exactly one new pellet spawns at an interior cell that is never on
// the snake (and, in Maze, never on an obstacle). The round is seeded and a run of
// eats is forced (place a pellet ahead, run the head into it); after each eat the
// AUTO-spawned pellet — the one the real spawn code chose, not the one we placed — is
// read back and checked for validity. So the check observes the real spawn, not the
// precondition.
//
// WHY THIS ITEM RECORDS A CLIP RATHER THAN A STILL. The claim is about EVERY respawn,
// not one of them: a build that places its first pellet well and then starts dropping
// them on the snake fails this item, and a single frame cannot tell those two apart —
// it shows one pellet, in one legal spot, which is exactly what a broken build also
// shows most of the time. Filming the whole run puts every spawn the assertions scored
// on camera in the order they happened, so what a reviewer watches is the same
// evidence the verdict was decided on.
//
// The eats are therefore spaced (`gap`) rather than taken one a tick. At a gap of 1 the
// eight eats are over in a second, and each respawned pellet is on screen for 125 ms —
// technically filmed, in practice a flicker. Travelling a couple of cells between them
// lets each new pellet be seen where it landed before the next eat replaces it, which
// is the whole point of recording this one.

import {
  actEatSequence,
  actPlayOn,
  arrangeEatLane,
  isInterior,
  onSnake,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

const N = 8;

// Cells travelled between eats. The lane is what limits it: `arrangeEatLane` poses the
// head at col 3 (a 3-cell snake cannot start further left — the wall is at col 0) and
// the interior ends at col 28, so the run has 25 columns to spend and takes `N * GAP`
// of them. A gap of 2 spends 16 and leaves the head at col 19, with room for the tail
// below; 3 would spend 24 and finish the run one column short of the wall, which the
// exact validate pass would survive and a drifting record pass might not.
const GAP = 2;

// The last eat respawns a pellet like every other one, and the item is about that
// spawn as much as the seven before it — so keep filming after the run ends, or the
// clip cuts away before the final respawn is ever on screen. From col 19, 6 ticks stop
// at col 25, clear of the wall.
const HOLD_TICKS = 6;

export default function item() {
  // Whether this build is the Maze variant, and the snapshot after each of the N eats.
  let maze;
  let snaps;

  return {
    id: "growth.pellet-respawn-valid",

    async arrange(api) {
      await beginRound(api, 24601);
      maze = (await api.snapshot()).mode === "maze";
      await arrangeEatLane(api); // the old setSnake(hLane(3, 8, 3), "right")
    },

    async act(api) {
      ({ snaps } = await actEatSequence(api, { count: N, gap: GAP }));
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

      let allValid = true;
      for (let i = 0; i < N; i += 1) {
        const s = snaps[i]; // s.pellet is the AUTO-spawned pellet
        const p = s.pellet;
        const valid =
          p !== null &&
          isInterior(p) &&
          !onSnake(p, s.snake) &&
          (!maze || !obstacleSet.has(cellKey(p)));
        if (!valid) allValid = false;
        check.expectOk(
          `respawn ${i + 1}: pellet ${JSON.stringify(p)} is interior, off the snake${maze ? " and off obstacles" : ""}`,
          valid,
        );
      }
      check.expectEq(`all ${N} respawned pellets were valid`, allValid, true);
    },
  };
}
