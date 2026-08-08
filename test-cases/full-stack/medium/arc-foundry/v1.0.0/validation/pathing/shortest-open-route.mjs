// Automated validation for pathing.shortest-open-route: towers are walls — building across
// a leg lengthens the shortest open route the Load must take, and a unit routes around it.
//
// The maze length (the ground route through the ordered chain) is read before and after a wall
// is dropped on the direct first-leg corridor; it must rise. A unit then walks and advances
// along the chain around the wall.
//
// ONE WALL IS THE WHOLE CLAIM. The route's length is the sum of its step lengths, a diagonal step
// counting sqrt(2) tiles against an orthogonal step's 1 (`specs/board.md` "Shortest open route"
// and "Diagonal rule"), so a single 2x2 piece the route has to round raises the figure — which is
// exactly what this item says building does. Nothing here needs a bigger structure than the one
// placement the claim is about.
//
// WHAT IS FILMED, AND WHY THE WALL IS NO LONGER POSED OFF CAMERA. The wall used to be dropped in
// `arrange`, which is instant in both passes — so the recording opened on a board that already
// had the wall on it, and the one event this item is about, a placement LENGTHENING the route,
// had happened before the first frame. Only the aftermath was on camera.
//
// The wall is a control op and control ops are legal mid-`act`, so it is dropped there instead,
// after a beat on the open board. The clip is then the sentence the item states: the corridor as
// it was, the rock landing across it, the maze figure rising, and a unit walking the detour.
//
// The beat has to come BEFORE the drop rather than the unit: a rock can only be placed during a
// build phase, and releasing a unit puts the run into a live wave (`specs/instrumentation.md`),
// which spends the phase's stamps. So the order is fixed — open board, wall, then the walk.

import { startBuild, buildMazeWall, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// A beat on the untouched corridor before the rock lands, so the route the wall lengthens is on
// screen as itself first.
const LEAD_TICKS = 1 * SECOND;
// A beat on the landed wall, so the new route reads before anything walks it.
const SETTLE_TICKS = 0.5 * SECOND;
// 2 s = 120 ticks, long enough for the Spark (120 px/s) to be well into its detour.
const WALK_TICKS = 2 * SECOND;

export default function item() {
  // The route before and after the wall, plus the unit as released and after its walk.
  let len0;
  let len1;
  let u;
  let live;

  return {
    id: "pathing.shortest-open-route",

    async arrange(api) {
      const s0 = await startBuild(api);
      len0 = s0.mazeLength;
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the corridor as it stands, before anything is built on it

      await buildMazeWall(api);
      len1 = (await snap(api)).mazeLength;
      await api.advance(SETTLE_TICKS);

      [u] = await spawnControlled(api, "spark");
      await api.advance(WALK_TICKS);
      live = unitById(await snap(api), u.id);
    },

    async assert(api, check) {
      check.expectGt("placing a wall across a leg lengthens the shortest open route", len1, len0);
      check.expectOk(
        "a unit still routes past the wall along the chain",
        !live || live.waypointIndex >= u.waypointIndex,
      );
    },
  };
}
