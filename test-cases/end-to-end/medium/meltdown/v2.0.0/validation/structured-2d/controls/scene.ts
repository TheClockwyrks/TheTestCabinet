// controls/scene — the two readings and the two anchors this group poses on.
//
// Both readings are READINGS, not thresholds: each names a control the panel is
// required to be carrying in the state the scenario posed, and fails saying which
// one the build reported nothing for. Every figure a check asserts stays in the
// check that asserts it.
//
// Local to this group on purpose. Nothing outside `controls/` operates the panel
// through its reported rectangles, so neither belongs in the shared harness.

import { fail } from "../assert";
import {
  shopEntry,
  type ControlRect,
  type Harness,
  type MeltdownSnapshot,
  type ShopControl,
  type Tile,
  type TowerType,
} from "../harness";

/** The controls a snapshot reports as a rectangle, or as `null` when it draws none. */
type OptionalControl = "rotate" | "cancel" | "upgrade" | "sell";

/**
 * The rectangle the panel reported for a control it is required to be drawing,
 * or a failure naming the control it reported nothing for.
 *
 * The four optional controls are `null` for a stated reason and no other:
 * specs/hud.md draws Rotate and Cancel "only while a preview is held", and
 * specs/instrumentation.md reports `upgrade` and `sell` as `null` only "when no
 * tower is selected". So a scenario that posed the state a control belongs to and
 * found none has found a missing control rather than a null to work around, and
 * that is what this says.
 */
export function requireControl(
  snapshot: MeltdownSnapshot,
  name: OptionalControl,
  context: string,
): ControlRect {
  const rect = snapshot.controls[name];
  if (rect === null) {
    return fail(
      `a ${name} rectangle on the build panel while ${context} ` +
        `(specs/hud.md, specs/instrumentation.md)`,
      null,
    );
  }
  return rect;
}

/**
 * The rectangle the panel reported for one shop entry, or a failure naming the
 * type it drew no entry for.
 *
 * specs/hud.md: "The shop lists all eight towers, one entry per type", so an
 * entry that is missing is a missing entry. That the eight are all there and in
 * shop order is `hud.shop-lists-eight`'s requirement; this only reaches for the
 * one a scenario is about.
 */
export function requireShopEntry(
  snapshot: MeltdownSnapshot,
  type: TowerType,
  context: string,
): ShopControl {
  const entry = shopEntry(snapshot, type);
  if (entry === undefined) {
    return fail(
      `a ${type} entry in the build panel's shop while ${context} ` +
        `(specs/hud.md, The shop)`,
      snapshot.controls.shop.map((row) => row.type),
    );
  }
  return entry;
}

/**
 * A footprint anchor that is quiet in both senses: clear of all four openings and
 * of both straight vent-to-exhaust corridors, so a tower posed here lengthens
 * neither route and nothing about the floor's geometry enters a reading about a
 * key or a tap.
 *
 * specs/floor.md runs the left corridor along rows `16` to `19` and the top
 * corridor down columns `22` to `29`; this anchor and the whole of the largest
 * footprint laid on it stay out of both.
 */
export const QUIET_SITE: Tile = { col: 4, row: 4 };

/**
 * A second quiet anchor, twelve tiles away on both axes.
 *
 * Far enough that a footprint on one cannot cover a tile of the other at any of
 * specs/towers.md's three sizes, which is what makes a tap on this one a tap on
 * OPEN floor while a tower stands on {@link QUIET_SITE}.
 */
export const FAR_SITE: Tile = { col: 16, row: 30 };

/**
 * The frames run after a press before the mute bit is read back.
 *
 * specs/instrumentation.md: `muted` is "the game's copy of the runtime's mute
 * bit, refreshed in every update ... It is not read at the call". A build is free
 * to refresh its copy before or after the frame that answered the press, so two
 * frames are run rather than one and the reading is the same either way. It is a
 * settling allowance, not a tolerance on any figure.
 */
export const MIRROR_FRAMES = 2;

/** Run {@link MIRROR_FRAMES} frames, so the snapshot's mute copy is current. */
export function settleMuteMirror(h: Harness): Promise<void> {
  return h.advance(MIRROR_FRAMES);
}
