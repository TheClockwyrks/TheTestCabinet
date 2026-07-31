// Automated validation for the Targeting sub-item `ground-and-air`.
//
// A general emitter (not the air-only Flak) can damage both a ground unit and a flyer
// in range (specs/towers.md). We confirm a plain Arc damages a ground Hulk, then a
// Drift flyer.
//
// The Arc is set into a vent corridor. The ground half of this item is the half that
// depends on a route: a flyer goes straight from its vent to its exhaust and passes
// anything on that line, but a walking Hulk takes whichever shortest route the build's
// pathfinder prefers, and an Arc parked beside an assumed lane simply never sees it on
// a build that sets off diagonally — which this item would read as an emitter that
// cannot hit ground. The corridor walls the vent so every route runs past the gun; the
// flyer half is unaffected, since a flyer ignores the maze entirely
// (`specs/playfield.md`) and crosses the corridor's roof on its way through. See the
// note above `buildVentCorridor` in `_helpers`.

import {
  newGame,
  restartGame,
  buildVentCorridor,
  spawn,
  actTail,
  CORRIDOR_WALLS,
  TICK,
} from "../_helpers.mjs";

// Pose a hot Arc in a vent corridor with a unit of `surgeType` walking or flying into
// its range, and return that unit's id along with the corridor's wall count. `start`
// is the fresh-match helper to use: `newGame` in arrange, and `restartGame` in act —
// this is a genuine two-configuration comparison (ground unit, then flyer), so the
// second setup lands mid-drive, where `reset()` (and therefore `newGame`) throws.
async function poseArcAgainst(api, start, surgeType) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const corridor = await buildVentCorridor(api, "arc");
  await api.call("setHeat", corridor.id, 80);
  const target = await spawn(api, surgeType, "left");
  return { target, walls: corridor.walls };
}

// 480 ticks = the old 8s cap; polling every tick catches the first hit.
const untilDamaged = (api, id) =>
  api.until((s) => s.surge.some((u) => u.id === id && u.hp < u.maxHp), {
    max: 480,
    poll: TICK,
  });

export default function item() {
  let groundId;
  let walls;
  let ground;
  let air;

  return {
    id: "targeting.ground-and-air",

    // Two configurations, each a unit walking or flying into an Arc's range and being
    // hit — a few seconds apiece on a conformant build. The ceiling is what stops a
    // build that routes its Hulk the long way round from turning that into a
    // twenty-second clip. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 6000,

    // Configuration A: a ground Hulk.
    async arrange(api) {
      const posed = await poseArcAgainst(api, newGame, "hulk");
      groundId = posed.target;
      walls = posed.walls;
    },

    // Damage the ground unit, then re-pose the same Arc against a flyer and damage
    // that. Both drives are filmed back to back.
    //
    // Each half runs on past the hit that ends its sweep. `untilDamaged` stops on the
    // tick a shot connects, which is the tick before it is legible — the health bar has
    // had no frame to move in — and the corridor now hands the Arc its target within a
    // beat of the drive starting, so without the tails the whole clip is two units
    // appearing and nothing visibly happening to either.
    async act(api) {
      ground = await untilDamaged(api, groundId);
      await actTail(api);

      const airPosed = await poseArcAgainst(api, restartGame, "drift");
      air = await untilDamaged(api, airPosed.target);
      await actTail(api);
    },

    async assert(api, check) {
      // A hole in the corridor lets the Hulk walk round the Arc, which would read as an
      // emitter that cannot hit ground rather than as missing scenery.
      check.expectEq("the vent corridor was built", walls, CORRIDOR_WALLS);
      check.expectOk("the Arc damages a ground unit", ground.hit);
      check.expectOk("the Arc damages an air unit", air.hit);
    },
  };
}
