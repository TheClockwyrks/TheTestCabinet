// Fathom — reaching a screen and reading what it drew, for the `states/*` points.
// CASE-PROVIDED.
//
// Six points share three problems, so they share this file rather than each
// solving them again:
//
//   WHAT DID THE FRAME PUT ON THE CANVAS? `specs/ui.md` fixes copy for four of
//   the seven screens — `FATHOM`, `HUNT IN THE DARK`, each menu's items, and the
//   cleared interstitial's `DEPTH 1 CLEARED` — and a screen that exists as a
//   value of `screen` while drawing nothing is exactly what these points are for.
//   So a screen is read twice over: from `snapshot().screen`, and from the text
//   the frame actually drew.
//
//   MATCHING IS BY SUBSTRING, NEVER BY EQUALITY. `specs/ui.md` fixes the WORDS a
//   screen shows and leaves the presentation to the build, and a menu item is
//   commonly drawn with a selection marker or padding around it — all three
//   reference implementations draw the selected item as `> DIVE <`. Requiring the
//   exact run would fail a screen showing precisely the right words. The runs are
//   folded to upper case for the same reason: `specs/ui.md` states the copy in
//   capitals and says nothing about case. (This is why the checks here do not use
//   the harness's own `drewText`, which compares whole runs.)
//
//   HOW LONG DID A SCREEN HOLD, AND DID ANYTHING MOVE BEHIND IT? `specs/ui.md`
//   times the countdown and the cleared interstitial on "the simulation's own
//   accumulated time", which is `simTime`, and fixes what advances on each
//   screen. Both readings want the same shape of watch: step one frame at a time,
//   keep the last snapshot taken while the screen still stood, and stop the
//   moment it gives way — with a HARD ceiling, so a build whose screen never
//   gives way fails on the bound rather than running until the suite times out.
//
// It drives nothing the specification does not give it: `reset`, `setScreen` and
// the predator poses come from `specs/instrumentation.md`, and every key it
// presses is one `specs/movement.md` binds.

import { BINDINGS } from "../../src/constants";
import { assertMatches } from "../assert";
import { callsTo, DIR_KEY, type DrawCall, type Harness } from "../harness";
import type { FathomSnapshot } from "../surface";

/** The key `specs/movement.md` binds `confirm` to first: it takes a menu item. */
export const CONFIRM_KEY = BINDINGS.confirm[0];

/** The key `specs/movement.md` binds `back` to: it leaves the current screen. */
export const BACK_KEY = BINDINGS.back[0];

/** The key `specs/movement.md` binds `pause` to first. */
export const PAUSE_KEY = BINDINGS.pause[0];

/** The key that moves a menu selection down one item (`specs/movement.md`). */
export const MENU_DOWN_KEY = DIR_KEY.down;

/** The key that swims the forager right, for a check that asks whether it did. */
export const MOVE_KEY = DIR_KEY.right;

/* -------------------------------------------------------------------------- */
/* What one frame drew                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run exactly one frame and hand back every operation its render issued.
 *
 * One frame, because a screen has to be DRAWN to be read and the build draws from
 * its own render pass. The screens this is called on advance nothing
 * (`specs/ui.md`), so the frame changes nothing a check then reads.
 */
export async function frameOps(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/** Every string the frame put on the canvas, through `fillText` or `strokeText`. */
export function textRuns(ops: readonly DrawCall[]): string[] {
  return [...callsTo(ops, "fillText"), ...callsTo(ops, "strokeText")].flatMap(
    (args) => (typeof args[0] === "string" ? [args[0]] : []),
  );
}

/** Every run the frame drew, folded to upper case and joined for one reading. */
export function drawnText(ops: readonly DrawCall[]): string {
  return textRuns(ops).join(" | ").toUpperCase();
}

/** The frame drew `text` somewhere in some run of text, ignoring case. */
export function assertDrew(
  ops: readonly DrawCall[],
  text: string,
  context: string,
): void {
  assertMatches(drawnText(ops), text.toUpperCase(), context);
}

/* -------------------------------------------------------------------------- */
/* Telling two frames apart                                                   */
/* -------------------------------------------------------------------------- */

/** One operation as a comparable string. Objects compare by kind, not identity. */
function fingerprint(op: DrawCall): string {
  const show = (value: unknown): string => {
    if (value === null) return "null";
    const kind = typeof value;
    if (kind === "number" || kind === "boolean" || kind === "string") {
      return JSON.stringify(value);
    }
    if (kind === "undefined") return "undefined";
    return `[${kind}]`;
  };
  return op.kind === "call"
    ? `call ${op.method}(${op.args.map(show).join(",")})`
    : `set ${op.property}=${show(op.value)}`;
}

/**
 * How many operations two frames differ in: the count of positions where their
 * operation logs do not match, plus whatever length one has over the other.
 *
 * Used to ask whether a frame CHANGED, never what it changed to. `specs/ui.md`
 * requires the selected menu item to be "drawn distinctly from the others", and
 * how a build draws that — brighter text, a marker beside it, a panel behind it —
 * is the build's own. All this can say is that moving the selection changed the
 * picture, which is exactly the observable consequence of drawing it distinctly,
 * and it is measured against a baseline taken with the selection unmoved so a
 * screen that animates on its own cannot make the reading vacuous.
 */
export function opDiff(a: readonly DrawCall[], b: readonly DrawCall[]): number {
  let differing = 0;
  const longest = Math.max(a.length, b.length);
  for (let index = 0; index < longest; index += 1) {
    const left = index < a.length ? fingerprint(a[index]) : null;
    const right = index < b.length ? fingerprint(b[index]) : null;
    if (left !== right) differing += 1;
  }
  return differing;
}

/* -------------------------------------------------------------------------- */
/* Watching a screen give way                                                 */
/* -------------------------------------------------------------------------- */

/** What a screen watch saw. */
export interface ScreenWatch {
  /** The screen gave way inside the budget. */
  hit: boolean;
  /** How many frames were driven. */
  ticks: number;
  /** The last snapshot taken while the screen still stood. */
  last: FathomSnapshot;
  /** The first snapshot taken after it gave way, or `last` where it never did. */
  after: FathomSnapshot;
}

/**
 * Step one frame at a time, holding `code` if one is given, until `screen` is no
 * longer the screen the game is showing.
 *
 * The last snapshot taken WHILE THE SCREEN STOOD is kept separately from the
 * first one taken after, because a check that asks whether anything moved behind
 * a screen must compare two readings from inside it: on the frame play resumes
 * the game is entitled to move everything at once.
 */
export async function watchScreen(
  h: Harness,
  screen: string,
  maxTicks: number,
  code?: string,
): Promise<ScreenWatch> {
  if (code !== undefined) h.hold(code);
  try {
    let last = h.snapshot();
    for (let step = 1; step <= maxTicks; step += 1) {
      await h.advance(1);
      const now = h.snapshot();
      if (now.screen !== screen) {
        return { hit: true, ticks: step, last, after: now };
      }
      last = now;
    }
    return { hit: false, ticks: maxTicks, last, after: last };
  } finally {
    if (code !== undefined) h.release(code);
  }
}

/* -------------------------------------------------------------------------- */
/* Spending the run                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The frames one staged catch is given before the check gives up on it.
 *
 * A predator whose center lies on the forager's own tile is in contact with it
 * (`specs/gameplay.md`), so a conforming build takes the life on the next tick.
 * Two seconds is a hard ceiling on that rather than an expectation.
 */
const CATCH_TICKS = 240;

/** How many attempts a run of `START_LIVES` reserves plus the played one needs. */
const MAX_ATTEMPTS = 8;

/**
 * Spend every life the dive has, one staged catch at a time, and hand back where
 * that left the game.
 *
 * Each attempt places the first predator of the roster the check posed on the
 * forager's own tile and
 * poses it into `"chase"`, which is contact as `specs/gameplay.md` defines it,
 * then waits on the build's own contact rule to take the life. Between attempts
 * the dive is on the countdown (`specs/progression.md`), so `setScreen("playing")`
 * opens live play again and the next attempt runs. Nothing here fabricates a
 * death: every one of them goes through the build's own code.
 *
 * WHICH predator is deliberately the roster's index `0` rather than a named kind:
 * `specs/gameplay.md` costs a life for contact "whatever that predator's kind and
 * whatever it is doing", and `specs/state.md` fixes index `0` as the first of the
 * release order at every depth.
 */
export async function loseEveryLife(h: Harness): Promise<FathomSnapshot> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let snapshot = h.snapshot();
    if (snapshot.screen === "gameover") return snapshot;
    if (snapshot.screen === "countdown") {
      h.debug.setScreen("playing");
      snapshot = h.snapshot();
    }
    if (snapshot.screen !== "playing") return snapshot;

    const lives = snapshot.lives;
    h.debug.setPredatorTile(0, snapshot.forager.tx, snapshot.forager.ty);
    h.debug.setPredatorState(0, "chase");
    const taken = await h.until(
      (s) => s.lives < lives || s.screen === "gameover",
      { maxFrames: CATCH_TICKS, poll: 2 },
    );
    if (!taken.hit) return taken.snapshot;
  }
  return h.snapshot();
}
