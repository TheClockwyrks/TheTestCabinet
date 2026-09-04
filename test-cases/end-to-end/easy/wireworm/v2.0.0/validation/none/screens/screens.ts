// Wireworm — reaching the screen a `screens` check starts from, and reading one
// frame back as a digest. PRIVATE to the screens/ directory.
//
// Every check in this directory is about a SCREEN: what one draws, and where a
// key pressed on it leaves the game. So the screen itself is what each check
// poses, through the atomic operations `specs/instrumentation.md` gives for it —
// `setScreen`, `setMenuIndex`, `setScore`, `setLives`, `setLevel`,
// `setReachedLevel` — and never by playing a run into that screen. Posing is
// what keeps the verdict on the screen: a check about what the Victory screen
// reports must not also be a check about whether twelve levels can be cleared.
//
// THE ONE THING THAT IS NEVER POSED IS THE TRANSITION ITSELF. Where `confirm`
// leaves the game is the requirement half of these checks decide, so it is
// always a real key through Chromium's input pipeline, read by the build's own
// keyboard on the build's own frame.
//
// THE HIGHLIGHT IS POSED TOO, WITH `setMenuIndex`, rather than walked to with
// presses. A check about what the second title item opens would otherwise be
// deciding the down binding as well — which `controls/menu-down` already
// decides — and the two wrap checks would be leaning on the very movement they
// are there to grade.
//
// Nothing here asserts a verdict. A helper fails only when the game is not in
// the situation the caller's scenario needs, and then with the requirement
// named, so a check never grades a scenario it was never in.

import { assertEqual } from "../assert";
import type { DrawCall, Harness, Screen } from "../harness";

/* -------------------------------------------------------------------------- */
/* The keys these checks press                                                */
/* -------------------------------------------------------------------------- */
//
// Each is one of the bindings `specs/controls.md` fixes, named here so a check
// reads as the ACTION it is pressing rather than as a `KeyboardEvent.code`.

/** `confirm`: `Enter`. `Space` confirms too, and `controls/confirm-space` grades it. */
export const CONFIRM_KEY = "Enter";

/** `back`: `Escape`. */
export const BACK_KEY = "Escape";

/**
 * `pause`: `KeyP`.
 *
 * `Escape` pauses as well, but it drives `back` too and the screen decides
 * which applies; `KeyP` drives nothing else, so a pause check that presses it
 * cannot fail over that resolution. `controls/pause-p` and
 * `controls/pause-escape` are where each key is graded.
 */
export const PAUSE_KEY = "KeyP";

/** `down` and `up`, on a menu: the arrow half of each binding. */
export const MENU_DOWN_KEY = "ArrowDown";
export const MENU_UP_KEY = "ArrowUp";

/* -------------------------------------------------------------------------- */
/* Posing a screen                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Put the game on a fresh title screen with the highlight on `menuIndex`.
 *
 * `reset` is the surface's own operation and `specs/instrumentation.md` states
 * that it restores every declared field to its title-screen value, so this is
 * the whole of what reaching the title takes. The highlight is then posed rather
 * than walked to, so a check about the item under it is not also a check about
 * the movement that would have got there.
 */
export async function poseTitle(h: Harness, menuIndex = 0): Promise<void> {
  await h.debug.reset();
  await h.debug.setMenuIndex(menuIndex);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, menuIndex, "the posed title highlight");
}

/**
 * Put the game on the how-to screen.
 *
 * Posed with `setScreen` rather than confirmed into from the title, because
 * `screens/title-howto` is the item that decides the route and a check about
 * what the how-to screen DOES must not fail over it.
 */
export async function poseHowto(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  await h.debug.setMenuIndex(0);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "setScreen poses the howto screen",
  );
}

/** The run an end screen is posed to report. */
export interface EndingRun {
  score: number;
  lives: number;
  level: number;
  reachedLevel: number;
  /** Which of `ENDING_ITEMS` the highlight rests on. Defaults to the first. */
  menuIndex?: number;
}

/**
 * Put the game on `victory` or `gameover`, reporting the run in `run`.
 *
 * Every field is a separate atomic pose, which is what lets a check pose
 * `level` and `reachedLevel` APART: the end screens report the level the run
 * reached, so a check that wants to know the screen is reading the right one
 * poses the two differently and reads the one the specification names.
 */
export async function poseEnding(
  h: Harness,
  screen: Extract<Screen, "victory" | "gameover">,
  run: EndingRun,
): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen(screen);
  await h.debug.setScore(run.score);
  await h.debug.setLives(run.lives);
  await h.debug.setLevel(run.level);
  await h.debug.setReachedLevel(run.reachedLevel);
  await h.debug.setMenuIndex(run.menuIndex ?? 0);
  const posed = await h.snapshot();
  assertEqual(posed.screen, screen, `setScreen poses the ${screen} screen`);
  assertEqual(posed.reachedLevel, run.reachedLevel, "the posed level reached");
  assertEqual(posed.lives, run.lives, "the posed lives remaining");
  assertEqual(posed.score, run.score, "the posed score");
}

/**
 * Pause a live board with the real pause key and rest the highlight on
 * `menuIndex`.
 *
 * The press is real because pausing is what raises this screen; the highlight
 * that follows is posed, because `specs/ui.md` fixes what each `PAUSE_ITEMS`
 * entry does and not where the highlight sits when the menu opens.
 */
export async function pauseLiveBoard(
  h: Harness,
  menuIndex?: number,
): Promise<void> {
  await h.tap(PAUSE_KEY);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the pause key raises the pause screen over live play",
  );
  if (menuIndex !== undefined) {
    await h.debug.setMenuIndex(menuIndex);
    assertEqual(
      (await h.snapshot()).menuIndex,
      menuIndex,
      "the posed pause highlight",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a whole frame back as one value                                    */
/* -------------------------------------------------------------------------- */

/**
 * A short, order-sensitive digest of everything one frame drew.
 *
 * WHAT IT IS FOR. Two of the items here ask whether a screen's drawing DEPENDS
 * on a value — whether the title marks which item is highlighted, and whether
 * the Victory screen reports the lives remaining. Neither can be read as text:
 * `specs/ui.md` fixes no highlight treatment at all (a colour, a marker, a
 * weight, a plate behind the row are all conformant) and it lets a lives readout
 * be "a row of icons or as a count". So what is decided is that the frame comes
 * out DIFFERENT when the value is different, which every conformant treatment
 * satisfies and a screen that shows neither does not.
 *
 * WHAT IS LEFT OUT, AND WHY. A `drawImage`'s first argument names the bitmap,
 * and `specs/assets.md` has the animated sprites alternate frames on the game's
 * own clock — so two frames of a perfectly steady screen name different bitmaps
 * purely because time passed between them. The rest of the draw, its destination
 * box included, is kept, so a build that marks its highlight with a sprite is
 * still read: what moved is where that sprite was drawn.
 *
 * It is a comparison between two frames of the SAME build and never a value any
 * check states, so it fixes no threshold.
 */
export function renderDigest(calls: readonly DrawCall[]): string {
  let hash = 0x811c_9dc5;
  for (const call of calls) {
    const token =
      call.kind === "set"
        ? `set ${call.property}=${JSON.stringify(call.value) ?? ""}`
        : `${call.method}(${
            JSON.stringify(
              call.method === "drawImage" ? call.args.slice(1) : call.args,
            ) ?? ""
          })`;
    for (let i = 0; i < token.length; i += 1) {
      hash = Math.imul(hash ^ token.charCodeAt(i), 0x0100_0193) >>> 0;
    }
  }
  return `${calls.length} ops / ${hash.toString(16).padStart(8, "0")}`;
}
