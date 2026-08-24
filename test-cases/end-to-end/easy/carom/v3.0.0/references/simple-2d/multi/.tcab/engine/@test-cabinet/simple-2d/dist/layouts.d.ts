/**
 * The closed catalogue of touch layouts and the action vocabulary each one brings.
 *
 * A layout is a *vocabulary contract*, not a widget. Naming `dual-vertical` says
 * "the control scheme is two vertical sliders, and the actions in play are
 * `p1-up`, `p1-down`, `p2-up`, `p2-down`". Selecting one registers nothing and
 * draws nothing — the game still registers each action with its own binding — but
 * it fixes the vocabulary, which is what lets a driver read back what the build is
 * meant to speak as a static fact instead of inferring it from behaviour.
 *
 * The catalogue is **closed**, and an unknown name throws rather than falling back
 * to a default. A silent fallback would let a run be configured for one control
 * scheme and executed under another, so the run record would describe a run that
 * never happened; failing at selection time keeps the configuration and the run in
 * agreement. Adding a layout is a deliberate edit here (and an engine version bump),
 * not something a case can do from its manifest.
 */
import type { TouchLayout } from "./contract";
/**
 * The vocabulary every layout carries on top of its own.
 *
 * These four are universal because they are about the *shell* around the game
 * rather than the game itself — confirming a menu item, backing out, pausing, and
 * muting exist in every build regardless of how it is played. Putting them in one
 * place means a game binds `pause` once and gets it from whichever layout is live.
 */
export declare const MENU_ACTIONS: readonly string[];
/**
 * The catalogue, keyed by layout name, with the menu vocabulary already appended.
 *
 * Frozen all the way down: the layouts are shared state read by the engine and by
 * the game, so a caller that mutated a vocabulary in place would change what every
 * other reader sees. {@link touchLayout} exists for callers that want a vocabulary
 * they can extend.
 */
export declare const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>>;
/**
 * The layout named `name`, as a fresh copy the caller owns.
 *
 * The copy is deliberate. A game may register extra actions beyond its layout's
 * vocabulary, and a caller assembling that combined list should not have to know
 * that the catalogue entry it started from is frozen and shared.
 *
 * @throws if `name` is not in the catalogue — the error names every valid layout,
 * because the failure is almost always a typo in a case's configuration and the
 * fix is the list itself.
 */
export declare function touchLayout(name: string): TouchLayout;
//# sourceMappingURL=layouts.d.ts.map