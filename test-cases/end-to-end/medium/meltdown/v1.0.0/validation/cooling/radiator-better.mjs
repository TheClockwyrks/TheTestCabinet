// Automated validation for the Surface-cooling sub-item `radiator-better`.
//
// The radiator faces shed heat far better than plain faces (specs/heat.md). The
// comparison this item makes is about which faces point at the OPEN AIR — a radiator
// edge sheds 3.6 per edge-tile against a plain edge's 1.1 — and about nothing else.
//
// WHY THERE ARE BLOCKERS AT ALL. With all four faces on open air, a quarter turn
// changes nothing: the same two radiator edges and the same two plain edges are on the
// air whichever way the tower is pointing, so the two rotations cool identically and
// there is no claim to check. The difference only exists once some faces are covered.
// So two Arcs are posed with their east and west faces blocked and their north and
// south faces open, differing only in rotation: at rotation 0 the Arc's radiators (local
// N/S, specs/towers.md) are the faces on the air; at rotation 1 they have turned onto
// the blockers and the plain faces have the air instead. Same spot, same blockers, same
// number of open faces — the only variable left is WHICH KIND of face is on the air, and
// the radiator-facing Arc must end cooler.
//
// WHY THE BLOCKERS ARE FORGES, AND NOT SINKS.
//
// This used to block with Sinks, which is sound and almost unreadable. A Sink sheds 16
// per shared edge-tile (specs/towers.md) against a radiator edge's 3.6, so the two
// blocking Sinks were shedding several times more heat than every open face put
// together. That cancels — both Arcs carry the identical pair, so the term is the same
// on both sides and the inequality still holds — but it compresses the difference the
// rotation makes into a couple of points on a bar that is plunging anyway, and a
// reviewer watching the clip cannot see the finding for the noise. Worth being explicit
// about what a Sink does and does not do here, because it is the natural thing to
// wonder: a Sink's output is `sinkOutput * sharedEdgeTiles * (H / 100)` and takes no
// account of what kind of face it is touching, so it neither favours nor penalises the
// radiator side. It simply drowns the effect.
//
// A Forge held ABOVE its setpoint is the inert blocker this scenario wants. It "adds
// `0.9 * sharedEdgeTiles * max(0, setpoint - H)` heat per second" (specs/heat.md), which
// is exactly zero while `H` is above the setpoint — and a level-I Forge's setpoint is 72
// (specs/towers.md), so a window run from 98 down to the mid-70s never wakes it. It
// blocks the face, has no heat of its own, and does not conduct, so the whole of the
// difference on screen is the faces. The gap it leaves is around fifteen points rather
// than two.
//
// It is also self-limiting in the safe direction. If a build cools faster than the
// reference and its radiator-facing Arc does dip under 72 inside the window, the Forge
// starts warming THAT one — the cooler of the two — which can only shrink the gap, never
// invert it. So the assertion holds on a build whose rates differ, and a build whose
// Forge is wrong fails `forge.caps-setpoint`, where that belongs.
//
// The alternatives were considered and are all worse: an emitter used as a wall conducts
// across the very edge it is blocking (3.5 per edge-tile per degree of difference, which
// dwarfs everything here), and the casing wall is not a blocker at all — `specs/heat.md`
// counts "the off-grid casing wall" as open air, so a tower in a corner still has four
// open faces.
//
// BOTH ARCS COOL AT ONCE, SIDE BY SIDE. This used to cool one layout, restart the match,
// and cool the other — also sound, also unreadable. The clip showed one tower's heat bar
// falling, a cut, then another tower's heat bar falling, leaving a reviewer to carry the
// first number across the cut and compare it to the second from memory. Posing both on
// the same floor and running one cooling step over the pair puts the comparison in a
// single frame: two heat reads starting level and visibly separating.
//
// The pairs sit eight rows apart and share no edge, so neither Arc conducts into the
// other (conduction needs touching footprints, specs/heat.md) and neither Forge reaches
// the other Arc.

import { newGame, build, heatOf, tower } from "../_helpers.mjs";

// The two Arcs, and the Forges that blank their east and west faces.
const RAD_ROW = 12; // rotation 0 — radiator faces on the open N/S air
const PLAIN_ROW = 20; // rotation 1 — radiator faces turned onto the Forges
const ARC_COL = 12;

// Posed hot, but clear of the 100 trip: a tripped tower bleeds its heat off on the trip
// cooldown's schedule rather than through its faces (specs/heat.md), which is a
// different mechanism and not this one's.
const START_HEAT = 98;

// The level-I Forge setpoint the window has to stay above for the blockers to be inert
// (specs/towers.md). Asserted below rather than assumed.
const FORGE_SETPOINT = 72;

// How long both Arcs cool for. 108 ticks (1.8 s) is where the two curves are furthest
// apart while both are still above the Forge setpoint — past it the radiator-facing Arc
// reaches the setpoint and the blocker stops being inert (harmlessly, per the note
// above, but the reading is cleanest before that).
const COOL_TICKS = 108;

// Pose an Arc at `rot` with Forges blocking its E and W faces, hot, and return its id.
async function poseBlocked(api, row, rot) {
  const id = await build(api, "arc", ARC_COL, row, rot);
  await build(api, "forge", ARC_COL - 2, row); // W
  await build(api, "forge", ARC_COL + 2, row); // E
  await api.call("setHeat", id, START_HEAT);
  return id;
}

export default function item() {
  let radId;
  let plainId;
  let radFaces;
  let plainFaces;
  let radOpen;
  let plainOpen;

  return {
    id: "cooling.radiator-better",

    // Both Arcs are posed up front, on one floor, so the drive is a single cooling step
    // over the pair rather than two runs to be held in mind across a cut.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      radId = await poseBlocked(api, RAD_ROW, 0);
      plainId = await poseBlocked(api, PLAIN_ROW, 1);
      radFaces = (await tower(api, radId)).radiatorFaces;
      plainFaces = (await tower(api, plainId)).radiatorFaces;
    },

    // One cooling step, applied to both by the same ticks of the same simulation.
    async act(api) {
      await api.advance(COOL_TICKS);
      radOpen = await heatOf(api, radId);
      plainOpen = await heatOf(api, plainId);
    },

    async assert(api, check) {
      // The premise: the two Arcs really are turned different ways, and the difference
      // is which kind of face is on the open N/S air. A build that ignored the rotation
      // would report the same faces on both and the comparison below would be between
      // two identical layouts.
      check.expectOk(
        `the first Arc's radiators face the open air (N/S; saw ${radFaces.join("/")})`,
        radFaces.includes("N") && radFaces.includes("S"),
      );
      check.expectOk(
        `the second Arc's radiators face the blockers (E/W; saw ${plainFaces.join("/")})`,
        plainFaces.includes("E") && plainFaces.includes("W"),
      );

      // Both start at the same heat, so a build that cooled NEITHER reports them equal
      // and would sail through a bare `<` comparison. Something has to have been shed
      // before which of them shed more can mean anything.
      check.expectLt(
        "the radiator-facing Arc cooled at all",
        radOpen,
        START_HEAT,
      );
      // And the blockers were inert for the whole window, so what separates the two is
      // the faces and nothing the Forges did.
      check.expectGe(
        "both stayed above the Forge setpoint, so the blockers added no heat",
        radOpen,
        FORGE_SETPOINT,
      );
      check.expectLt(
        "radiator faces on open air cool faster than plain faces",
        radOpen,
        plainOpen,
      );
    },
  };
}
