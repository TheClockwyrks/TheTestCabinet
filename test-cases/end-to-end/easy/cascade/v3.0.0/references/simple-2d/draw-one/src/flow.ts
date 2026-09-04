// Cascade — the state a game opens on, and the one `reset` returns it to
// (specs/state.md, specs/instrumentation.md).
//
// Both are the same value, built here in one place, so a fresh engine and a
// scenario that has just reset are holding exactly the same game. The painted
// layer travels through rather than being rebuilt: it is a drawing resource the
// state carries, and a reset wipes it rather than replacing it.

import { DEFAULT_SEED } from "./constants";
import { emptyFoundations, emptyTableau } from "./moves";
import type { TrailLayer } from "./trail";
import type { CascadeState } from "./game";

/**
 * The title-screen state: every pile empty, nothing in hand, every gate on, no
 * cascade, and the seeded generator wound back to `seed`.
 *
 * `muted` is carried through rather than reset, because muting is a player
 * preference the runtime owns.
 */
export function openingState(
  seed: number = DEFAULT_SEED,
  muted = false,
  trail: TrailLayer | null = null,
): CascadeState {
  trail?.clear();
  return {
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,

    stock: [],
    waste: [],
    wasteSets: [],
    foundations: emptyFoundations(),
    tableau: emptyTableau(),

    drag: null,
    dropTarget: null,
    pointer: { x: 0, y: 0, down: false },
    lastPress: null,

    autoFlip: true,
    winDetect: true,
    launching: true,
    trailPainting: true,

    launchClock: 0,
    launched: 0,
    flyers: [],
    cascadeDone: false,
    trailStamps: 0,

    nextId: 1,
    simTime: 0,
    muted,
    rngState: seed,

    trail,
  };
}
