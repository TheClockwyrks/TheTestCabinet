// Deepcore — the surface the economy checks are posed on. CASE-PROVIDED.
//
// Every Credits point below is about a control a player clicks in a building
// panel, so the world each of them wants is the same one: the camp, with the
// mine emptied of everything that could bank a unit or cost a point of hull
// while the check runs, and the miner standing still on the camp ground where
// the panels open.
//
// `openScene` alone would leave the miner in mid-air, because the mine it leaves
// is open at `row 1` too, so the camp ground goes back exactly as generation
// leaves it. The drill is gated because none of these points exercises it: a
// check about a price must not be able to bank an ore unit on the way.

import {
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/**
 * The camp as an economy check finds it: off the clock, an empty mine under a
 * solid camp floor, the miner standing at the spawn, and the drill gated.
 *
 * Tier `1` on every track, a full tank and hull, `0` Credits and nothing held
 * are what `reset` leaves, so a check poses only the figures it is about.
 */
export function openCamp(h: Harness): void {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
}
