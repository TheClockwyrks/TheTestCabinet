// Automated validation for the Movement item `refuse-vehicle`.
//
// Hopping into a tile a vehicle already occupies is refused like a wall — the
// critter does not move and does not die (specs/hazards.md: "you die only when
// traffic runs into you, never by stepping into it"). See validation/_helpers.mjs.
//
// THE CRITTER HOPS UP INTO THE SIDE OF A VEHICLE THAT IS MOVING. That is the whole
// situation the rule exists for: the player is advancing, a vehicle is across the
// lane above, and the hop into its flank must cost nothing. The check used to park a
// plow (speed 0) beside the critter and hop SIDEWAYS into it, which tests the letter
// of the rule against a board state the game never produces — every vehicle in a lane
// is always moving (specs/hunter.md says so in as many words) — and never touches the
// direction a player meets it from. A build that refuses a sideways hop into stopped
// traffic but kills the critter for hopping up into a moving plow passed it.
//
// AND THE HOP IS STILL NOT WHAT KILLS. Hopping toward oncoming traffic is not a
// separate rule: the hop is refused wherever the vehicle is heading, the critter
// stays on the tile it was on, and if that vehicle then slides into THAT tile the
// critter is crushed by it arriving (specs/hazards.md) — which is `ice.crush`'s item,
// driven there with a plow sweeping into a critter that does not move. So this item
// stages the vehicle in the lane ABOVE the critter's, where it can block the hop
// without ever being able to reach the critter's own tile: what the clip shows and
// what the assertions read is the refusal alone, with nothing else that could end the
// crossing while it is being read.
//
// THE PRESS WAITS FOR THE VEHICLE TO COVER THE WHOLE TILE. The plow is posed a few
// tiles up-lane and slides in under its own lane motion, and the hop goes in once the
// sweep confirms the target tile is covered outright — see `laneCoversWhole` for why
// the first pixel of overlap is the one moment a build may honestly disagree that the
// tile is occupied. So the tile really is blocked when the key goes down (asserted,
// not assumed), and the clip opens on the traffic arriving rather than on a vehicle
// that was always there.

import {
  iceLaneAt,
  laneCoversWhole,
  startCrossing,
  ICE_TOP,
  REFUSE_LEAD_TICKS,
  REFUSE_TAIL_TICKS,
} from "../_helpers.mjs";

// The lane the vehicle sweeps down (row 11: a 3-tile plow, specs/hazards.md), the row
// the critter stands on, and the column it tries to hop up into.
const VEHICLE_ROW = ICE_TOP;
const CRITTER_ROW = ICE_TOP + 1;
const COL = 20;

// How far up-lane the vehicle is posed, so it slides into the target tile on camera
// rather than starting on top of it. Three tiles at row 11's own 1.7 tiles/second is
// about 1.8 s of approach.
const APPROACH_TILES = 3;

// How long the sweep will wait for the vehicle to reach the tile. Generous: it covers
// the approach at well under the lane's specified speed, and a build whose lane never
// brings a vehicle over the tile at all has not posed the scenario this item needs.
const ARRIVE_TICKS = 600; // 5 s

// The beat after the press, just past the hop cooldown, and the hold on the refusal.
const HOP_TICKS = 18; // 0.15 s

const LIVES = 3;

export default function item() {
  // Whether the tile was covered when the key went down, and the state after the hop.
  let coveredAtPress;
  let after;

  return {
    id: "movement.refuse-vehicle",

    // Pose the approach: the critter's own lane cleared (so nothing can reach it),
    // and a single vehicle placed up-lane in the row above, travelling on that lane's
    // own speed and direction. Which side it is posed on follows the lane's reported
    // direction, so the vehicle always slides TOWARD the target tile.
    //
    // The bear is taken off the board. The critter stands eight rows up the strait,
    // which is the condition a hunter emerges on (specs/hunter.md), and a bear that
    // reached it would end the crossing this item is reading. It cannot cross the
    // strait inside the few seconds filmed here, but removing it leaves the refusal as
    // the only thing that can decide the item.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBear", 0, null);
      await api.call("setLane", CRITTER_ROW, { cols: [] }); // the critter's lane: clear
      await api.call("placeCritter", COL, CRITTER_ROW);

      const lane = iceLaneAt(await api.snapshot(), VEHICLE_ROW);
      const dir = lane && lane.dir < 0 ? -1 : 1;
      // Up-lane of the target tile: to its right for a leftward lane, to its left for
      // a rightward one. The vehicle's own length is what it sweeps in with.
      const from = COL - dir * APPROACH_TILES;
      await api.call("setLane", VEHICLE_ROW, { cols: [from] });
    },

    // The vehicle sliding over the tile above, the hop up into its side, and the hold
    // on a critter that did not move — what is checked, and the clip.
    async act(api) {
      await api.advance(REFUSE_LEAD_TICKS); // camera only: the posed lane before it closes
      const arrival = await api.until(
        (s) => laneCoversWhole(iceLaneAt(s, VEHICLE_ROW), COL),
        { max: ARRIVE_TICKS, poll: 2 },
      );
      coveredAtPress = arrival.hit;
      await api.call("press", "ArrowUp"); // into the flank of the moving vehicle
      await api.advance(HOP_TICKS);
      after = await api.snapshot();
      await api.advance(REFUSE_TAIL_TICKS); // camera only: the critter still on its tile
    },

    async assert(api, check) {
      // The staging first, because everything below is read against it: a hop that was
      // never aimed at an occupied tile proves nothing about refusing one.
      check.expectOk(
        "a vehicle is covering the whole tile the critter hops into",
        coveredAtPress,
      );
      check.expectEq(
        "a hop up into a vehicle-occupied tile is refused (row unchanged)",
        after.critter.row,
        CRITTER_ROW,
      );
      check.expectEq(
        "and the critter does not move at all",
        after.critter.col,
        COL,
      );
      check.expectEq(
        "no death from a refused hop into traffic",
        after.screen,
        "playing",
      );
      check.expectNe(
        "no crush from hopping into the vehicle's side",
        after.phase,
        "dying",
      );
      check.expectEq("lives unchanged", after.lives, LIVES);
    },
  };
}
