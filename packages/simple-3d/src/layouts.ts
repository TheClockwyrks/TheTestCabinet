/**
 * The closed catalogue of touch layouts and the action vocabulary each one brings.
 *
 * A layout is a *vocabulary contract*, not a widget. Naming `stick-look` says
 * "the control scheme is a move stick and a look pad, one per side, and the
 * actions in play are the eight the scheme drives". Selecting one registers
 * nothing and draws nothing — the game still registers each action with its own
 * binding — but it fixes the vocabulary, which is what lets a driver read back
 * what the build is meant to speak as a static fact instead of inferring it from
 * behaviour.
 *
 * A stick's deflection on an axis drives the two opposed actions of that axis as
 * magnitudes, and the look pad and the steering wheel do the same, which is why
 * stick and pad actions are the ones a game typically registers `"analog"` — a
 * held key still gives an analog action full deflection.
 *
 * The catalogue is **closed**, and an unknown name throws rather than falling back
 * to a default. A silent fallback would let a run be configured for one control
 * scheme and executed under another, so the run record would describe a run that
 * never happened; failing at selection time keeps the configuration and the run in
 * agreement. Adding a layout is a deliberate edit here (and an engine version bump),
 * not something a case can do from its manifest.
 */

/**
 * A touch layout: the name of a control scheme and the action vocabulary it
 * brings with it.
 *
 * Selection is declarative. It tags the actions the game registers rather than
 * drawing controls or registering anything, so a reader can establish which
 * vocabulary is live as a static fact.
 *
 * Declared here rather than in `contract.ts` because that module carries the
 * shared recording contract alone; the input vocabulary belongs to the modules
 * that implement it, and the package root re-exports the type from here.
 */
export interface TouchLayout {
  /** The layout's name. */
  name: string;
  /** The action names the layout provides, including the universal menu actions. */
  actions: string[];
}

/**
 * The vocabulary every layout carries on top of its own.
 *
 * These four are universal because they are about the *shell* around the game
 * rather than the game itself — confirming a menu item, backing out, pausing, and
 * muting exist in every build regardless of how it is played. Putting them in one
 * place means a game binds `pause` once and gets it from whichever layout is live.
 */
export const MENU_ACTIONS: readonly string[] = Object.freeze([
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
const LAYOUT_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  /** One virtual stick — movement alone, for a game the camera drives itself. */
  "stick-move": ["move-forward", "move-back", "move-left", "move-right"],
  /** A move stick and a look pad, one per side — free movement and a free look. */
  "stick-look": [
    "move-forward",
    "move-back",
    "move-left",
    "move-right",
    "look-up",
    "look-down",
    "look-left",
    "look-right",
  ],
  /** The stick, the look pad, and two action buttons. */
  "stick-look-two-buttons": [
    "move-forward",
    "move-back",
    "move-left",
    "move-right",
    "look-up",
    "look-down",
    "look-left",
    "look-right",
    "a",
    "b",
  ],
  /** A steering wheel and two pedals — a driving game's axes. */
  "wheel-pedals": ["steer-left", "steer-right", "throttle", "brake"],
};

/**
 * The catalogue, keyed by layout name, with the menu vocabulary already appended.
 *
 * Frozen all the way down: the layouts are shared state read by the engine and by
 * the game, so a caller that mutated a vocabulary in place would change what every
 * other reader sees. {@link touchLayout} exists for callers that want a vocabulary
 * they can extend.
 */
export const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(LAYOUT_VOCABULARIES).map(
        ([name, vocabulary]) => [name, frozenLayout(name, vocabulary)] as const,
      ),
    ),
  );

/** One catalogue entry: its own vocabulary then the menu actions, frozen in place. */
function frozenLayout(
  name: string,
  vocabulary: readonly string[],
): TouchLayout {
  const layout: TouchLayout = {
    name,
    actions: [...vocabulary, ...MENU_ACTIONS],
  };
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
export function touchLayout(name: string): TouchLayout {
  const layout = TOUCH_LAYOUTS[name];
  if (layout === undefined) {
    const valid = Object.keys(TOUCH_LAYOUTS).join(", ");
    throw new Error(
      `Unknown touch layout "${name}". The catalogue is closed; valid layouts are: ${valid}.`,
    );
  }
  return { name: layout.name, actions: [...layout.actions] };
}
