// states — the shared reading of the two nothing-advances items.
//
// specs/screens.md, "What advances on each screen": on `title`, `howto`,
// `paused`, and `gameover`, "Nothing". The strongest spec-honest reading is
// the whole snapshot compared field for field — with ONE exception, the tick
// counter, which specs/instrumentation.md fixes as "ticks resolved since the
// last reset, on every screen; frozen screens still count them", so it is the
// one field a frozen screen is allowed (indeed expected) to move.

import type { KesslerSnapshot } from "../surface";

/** How much time passes over the held screen: two seconds of game time. */
export const HELD_TICKS = 120;

/** The snapshot without the tick counter: everything a frozen screen holds. */
export function stillSnapshot(
  snapshot: KesslerSnapshot,
): Omit<KesslerSnapshot, "ticks"> {
  const { ticks: _ticks, ...rest } = snapshot;
  return rest;
}
