// screens/scenes — the shared routes into the posed sessions the transition
// checks of this category stand on, written once so every suite enters the
// same way: through the surface alone, never through a menu.
//
// specs/instrumentation.md, `setScreen`: `"playing"` "Starts a fresh session
// exactly as confirming START does", and `"paused"` "Enters the pause overlay
// exactly as `Escape` does during play, freezing the simulation intact."

import type { Harness, KesslerSnapshot } from "../harness";

/** Reset and open a fresh session through the surface, never the title menu. */
export async function posePlaying(h: Harness): Promise<KesslerSnapshot> {
  await h.reset();
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/** A fresh session, paused through the surface the moment it opened. */
export async function posePaused(h: Harness): Promise<KesslerSnapshot> {
  await h.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScreen("paused");
  return h.snapshot();
}

/** How many live targets a snapshot holds, across all three rings. */
export function targetTotal(s: KesslerSnapshot): number {
  return s.rings.reduce((n, ring) => n + ring.targets.length, 0);
}
