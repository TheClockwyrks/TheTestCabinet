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
/**
 * The vocabulary every layout carries on top of its own.
 *
 * These four are universal because they are about the *shell* around the game
 * rather than the game itself — confirming a menu item, backing out, pausing, and
 * muting exist in every build regardless of how it is played. Putting them in one
 * place means a game binds `pause` once and gets it from whichever layout is live.
 */
export const MENU_ACTIONS = Object.freeze([
    "confirm",
    "back",
    "pause",
    "mute",
]);
/**
 * Each layout's *own* vocabulary, before the menu actions are appended.
 *
 * Declaring only the distinctive half here keeps the two concerns apart: this table
 * is the control scheme, {@link MENU_ACTIONS} is the shell, and no layout can
 * accidentally omit or redefine the shell's actions.
 */
const LAYOUT_VOCABULARIES = {
    /** Two vertical sliders, one per side — a two-player game sharing one screen. */
    "dual-vertical": ["p1-up", "p1-down", "p2-up", "p2-down"],
    /** One vertical slider — the single-player cut of the same shape. */
    "single-vertical": ["up", "down"],
    /** A four-way pad, for movement with no action buttons. */
    "dpad-4": ["up", "down", "left", "right"],
    /** The four-way pad plus two action buttons. */
    "dpad-4-two-buttons": ["up", "down", "left", "right", "a", "b"],
};
/**
 * The catalogue, keyed by layout name, with the menu vocabulary already appended.
 *
 * Frozen all the way down: the layouts are shared state read by the engine and by
 * the game, so a caller that mutated a vocabulary in place would change what every
 * other reader sees. {@link touchLayout} exists for callers that want a vocabulary
 * they can extend.
 */
export const TOUCH_LAYOUTS = Object.freeze(Object.fromEntries(Object.entries(LAYOUT_VOCABULARIES).map(([name, vocabulary]) => [name, frozenLayout(name, vocabulary)])));
/** One catalogue entry: its own vocabulary then the menu actions, frozen in place. */
function frozenLayout(name, vocabulary) {
    const layout = { name, actions: [...vocabulary, ...MENU_ACTIONS] };
    Object.freeze(layout.actions);
    return Object.freeze(layout);
}
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
export function touchLayout(name) {
    const layout = TOUCH_LAYOUTS[name];
    if (layout === undefined) {
        const valid = Object.keys(TOUCH_LAYOUTS).join(", ");
        throw new Error(`Unknown touch layout "${name}". The catalogue is closed; valid layouts are: ${valid}.`);
    }
    return { name: layout.name, actions: [...layout.actions] };
}
//# sourceMappingURL=layouts.js.map