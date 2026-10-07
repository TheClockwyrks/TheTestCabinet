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
//   exact run would fail a screen showing precisely the right words. The shared
//   harness's `drewText` reads exactly that way — a substring, ignoring case,
//   since `specs/ui.md` states the copy in capitals and says nothing about case —
//   so every copy check reads it directly. What this file adds is ORDER, which
//   `drewText` does not decide: each menu's items stack the way `specs/ui.md`
//   lists them.
//
//   AND THE RUNS READ ARE THE LOGICAL ONES, NEVER THE `fillText` SPLIT. A build
//   that letter-spaces a heading draws one glyph per call, which is the only
//   portable way to letter-space canvas text, and `specs/ui.md` fixes the copy a
//   screen shows while leaving its spacing to the build. The shared harness's
//   `drawnTextRuns` merges side-by-side draws on one baseline back into the run
//   they spell, and `drawnTextLines` is those runs as strings, so `FATHOM` drawn
//   a glyph at a time reads as `FATHOM` rather than as `F | A | T | H | O | M`.
//   Every raw string is a substring of its run, so the merge can only add a
//   match and never take one away.
//
//   HOW LONG DID A SCREEN HOLD, AND DID ANYTHING MOVE BEHIND IT? `specs/ui.md`
//   times the countdown and the cleared interstitial on "the simulation's own
//   accumulated time", which is `simTime`, and fixes what advances on each
//   screen. Both readings want the same shape of watch: step one tick at a time,
//   keep the last snapshot taken while the screen still stood, and stop the
//   moment it gives way — with a HARD ceiling, so a build whose screen never
//   gives way fails on the bound rather than running until the suite times out.
//
// It drives nothing the specification does not give it: `reset`, `setScreen` and
// the predator poses come from `specs/instrumentation.md`, and every key it
// presses is one `specs/movement.md` binds.

import { drawnTextLines } from "../case-harness/text";
import { ARROW_KEY, BINDINGS } from "../constants";
import { stageCatch } from "../fixtures";
import type { DrawCall, FathomSnapshot, Harness } from "../harness";

/** The key `specs/movement.md` binds `confirm` to first: it takes a menu item. */
export const CONFIRM_KEY = BINDINGS.confirm[0];

/** The key `specs/movement.md` binds `back` to: it leaves the current screen. */
export const BACK_KEY = BINDINGS.back[0];

/** The key `specs/movement.md` binds `pause` to first. */
export const PAUSE_KEY = BINDINGS.pause[0];

/** The key that moves a menu selection down one item (`specs/movement.md`). */
export const MENU_DOWN_KEY = ARROW_KEY.down;

/** The key that swims the forager right, for a check that asks whether it did. */
export const MOVE_KEY = ARROW_KEY.right;

/* -------------------------------------------------------------------------- */
/* What one frame drew                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run exactly one tick and hand back every operation its render issued.
 *
 * One tick, because a screen has to be DRAWN to be read and the build draws from
 * its own render pass. The screens this is called on advance nothing
 * (`specs/ui.md`), so the tick changes nothing a check then reads.
 */
export async function frameOps(h: Harness): Promise<DrawCall[]> {
  return h.frameCalls();
}

/**
 * Every logical run the frame spelled, in reading order down the frame.
 *
 * The shared harness's `drawnTextLines`, which coalesces a run drawn a glyph at a
 * time back into the string it spells (the header says why). It needs each text
 * call to carry its measured width and alignment, which this harness's recorder
 * attaches; without them nothing merges and each `fillText` is its own run.
 */
export function textLines(ops: readonly DrawCall[]): string[] {
  return drawnTextLines(ops);
}

/**
 * Where in the frame's reading order the first logical run spelling `text`
 * stands, or `-1` where none does.
 *
 * ORDER is the one fact the two menu points read that the shared harness's copy
 * readers do not answer: `specs/ui.md` stacks each menu's items in a fixed order,
 * and `drewText` decides only that an item is there. So this reads the shared
 * harness's `drawnTextLines` — every logical run the frame spelled, in reading
 * order down the frame and then across it — and places `text` at the first run
 * that spells it the way `drewText` matches copy: a substring ignoring case,
 * with the whitespace folded out of both sides. A menu point asserts every
 * placing it compares is not `-1` before comparing, because `-1` sorts before
 * everything.
 *
 * One run, not one baseline: `drewText` also joins the runs that share a
 * baseline, so an item drawn as two runs a wide gap apart on one line would pass
 * it and still not be placed here. All three references draw each item in one
 * call, and under a measured recorder an ordinary word space merges into the run
 * around it, so nothing the copy check accepts splits.
 */
export function runOrder(ops: readonly DrawCall[], text: string): number {
  const fold = (copy: string): string => copy.replace(/\s+/g, "").toUpperCase();
  const wanted = fold(text);
  return drawnTextLines(ops).findIndex((run) => fold(run).includes(wanted));
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
  /** How many ticks were driven. */
  ticks: number;
  /** The last snapshot taken while the screen still stood. */
  last: FathomSnapshot;
  /** The first snapshot taken after it gave way, or `last` where it never did. */
  after: FathomSnapshot;
}

/**
 * Step one tick at a time, holding `code` if one is given, until `screen` is no
 * longer the screen the game is showing.
 *
 * The last snapshot taken WHILE THE SCREEN STOOD is kept separately from the
 * first one taken after, because a check that asks whether anything moved behind
 * a screen must compare two readings from inside it: on the tick play resumes the
 * game is entitled to move everything at once.
 */
export async function watchScreen(
  h: Harness,
  screen: string,
  maxTicks: number,
  code?: string,
): Promise<ScreenWatch> {
  if (code !== undefined) await h.hold(code);
  try {
    let last = await h.snapshot();
    for (let step = 1; step <= maxTicks; step += 1) {
      await h.advance(1);
      const now = await h.snapshot();
      if (now.screen !== screen) {
        return { hit: true, ticks: step, last, after: now };
      }
      last = now;
    }
    return { hit: false, ticks: maxTicks, last, after: last };
  } finally {
    if (code !== undefined) await h.release(code);
  }
}

/* -------------------------------------------------------------------------- */
/* Spending the run                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The ticks one staged catch is given before the check gives up on it.
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
 * Each attempt places the roster's first predator on the forager's own tile and
 * poses it into `"chase"`, which is contact as `specs/gameplay.md` defines it,
 * then waits on the build's own contact rule to take the life. Between attempts
 * the dive is on the countdown (`specs/progression.md`), so posing the screen
 * back to `"playing"` ends it and the next attempt runs. Nothing here fabricates a death: every one of them
 * goes through the build's own code.
 *
 * WHICH predator is deliberately the roster's index `0` rather than a named kind:
 * `specs/gameplay.md` costs a life for contact "whatever that predator's kind and
 * whatever it is doing", and `specs/state.md` fixes index `0` as the first of the
 * release order at every depth.
 *
 * EVERY ATTEMPT STAGES ITS CATCH ON AN EMPTY BOARD. A catch here is a contact rule
 * rather than a chase, so the world each attempt runs in holds exactly one hunter
 * and every other body comes off it: a den emptying behind the staged contact is
 * a second hunter that could take the life instead. The roster comes back with
 * each attempt's fresh board, so {@link stageCatch} is called again every time
 * round.
 */
export async function loseEveryLife(h: Harness): Promise<FathomSnapshot> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let snapshot = await h.snapshot();
    if (snapshot.screen === "gameover") return snapshot;
    if (snapshot.screen === "countdown") {
      await h.debug.setScreen("playing");
      snapshot = await h.snapshot();
    }
    if (snapshot.screen !== "playing") return snapshot;

    const lives = snapshot.lives;
    await stageCatch(h, {
      tx: snapshot.forager.tx,
      ty: snapshot.forager.ty,
    });
    const taken = await h.until(
      (s) => s.lives < lives || s.screen === "gameover",
      { maxTicks: CATCH_TICKS, poll: 2 },
    );
    if (!taken.hit) return taken.snapshot;
  }
  return h.snapshot();
}
