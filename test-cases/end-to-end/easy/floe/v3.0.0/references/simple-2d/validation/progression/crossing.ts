// progression — the two arrangements the checks in this group share.
//
// A BAY'S MOUTH. A bay is filled by "a hop up from row 2" (specs/bays.md), and row
// 2 is the top row of the WATER BAND (specs/strait.md): a critter whose footing
// there is `water` falls in on that very tick (specs/water.md). So the critter
// cannot simply be posed at a bay's mouth — it has to be posed standing on a floe
// there, and that floe is part of the requirement's own situation rather than a
// bystander parked nearby. It is the SMALLEST floe the game has, a one-tile `pan`,
// laid by `poseLane`, which stops the lane before it adds anything, so the floe
// covers exactly the tile the critter stands on and holds still for as long as a
// check runs. Nothing else is put on the strait.
//
// A HOP THE CRITTER IS ASKED FOR. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a hop is requested with a key that
// is genuinely down while a tick runs. A key pressed and released before the frame
// would reach a build that reads the press edge and miss one that reads the key as
// held, and both readings are the specification's — so this drives the one gesture
// neither can miss, and drives it once.
//
// Both live here rather than on the shared harness because they are this group's:
// only the four checks about what a COMPLETED crossing leads to enter a bay, and
// the hop below is the one gesture this group ever asks the critter for.

import { BAYS, WATER_TOP } from "../constants";
import {
  holdFor,
  keyFor,
  poseLane,
  type Facing,
  type Harness,
} from "../harness";

/**
 * The column a bay is entered from: its left column.
 *
 * Either of a bay's two columns would do — specs/strait.md gives each bay two and
 * specs/hopping.md accepts a hop onto either — and the checks here name one so the
 * tile they pose is the tile they read.
 */
export function bayColumn(bay: number): number {
  return BAYS[bay][0];
}

/**
 * Stand the critter on a still floe at the mouth of bay `bay`, one hop below it.
 *
 * The critter keeps the facing, cooldown and `bestRow` it had: `setCritterTile`
 * touches none of them (specs/instrumentation.md), so the hop that follows is an
 * ordinary hop taken from row 2.
 *
 * It poses and returns; it runs no frame.
 */
export function poseAtBayMouth(h: Harness, bay: number): void {
  const col = bayColumn(bay);
  poseLane(h, WATER_TOP, "pan", [col]);
  h.debug.setCritterTile(col, WATER_TOP);
}

/**
 * Ask the critter for one hop in `direction`, and run the ONE tick that takes it.
 *
 * The key is held down across that tick and released after it, so the tick sees a
 * key genuinely down and a press edge genuinely armed, and the tick after it sees
 * neither. Exactly one frame of game time passes, which is what lets a check read
 * the state the hop itself produced.
 *
 * The cooldown is left RUNNING. A check that wants a second hop spends it with
 * `h.advance(HOP_COOLDOWN_TICKS)` of its own; a check that reads the landing does
 * not care.
 */
export async function requestHop(h: Harness, direction: Facing): Promise<void> {
  await holdFor(h, keyFor(direction), 1);
}
