// screens/scenes — the shared routes into the posed sessions the transition
// checks of this category stand on, written once so every suite enters the
// same way: through the surface alone, never through a menu.
//
// `setScreen` sets the screen and nothing else (specs/instrumentation.md), so a
// session is the harness's `startFreshSession` — the sequence of atomic poses
// that begins one the way confirming START begins it — and a pause over it is
// one further `setScreen`.

import {
  startFreshSession,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** Open a fresh session through the surface, never the title menu. */
export async function posePlaying(h: Harness): Promise<KesslerSnapshot> {
  return startFreshSession(h);
}

/** A fresh session, paused through the surface the moment it opened. */
export async function posePaused(h: Harness): Promise<KesslerSnapshot> {
  await startFreshSession(h);
  await h.debug.setScreen("paused");
  return h.snapshot();
}

/** How many live targets a snapshot holds, across all three rings. */
export function targetTotal(s: KesslerSnapshot): number {
  return s.rings.reduce((n, ring) => n + ring.targets.length, 0);
}
