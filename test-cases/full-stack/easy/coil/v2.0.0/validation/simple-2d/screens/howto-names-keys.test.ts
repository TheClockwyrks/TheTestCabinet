// screens/howto-names-keys — the how-to screen names the keys a player steers
// with.
//
// specs/ui.md has `howto` cover "the controls, naming the keys bound to each
// action in `specs/controls.md`", and specs/controls.md binds each of the four
// steering actions to two keys: an arrow and a letter of `WASD`. So the reading
// is, for each of the four directions, that the screen names AT LEAST ONE of the
// two keys bound to it — a screen that lists the arrows and a screen that lists
// `W A S D` are both complete, and one that names neither leaves the player with
// nothing to press.
//
// What a build calls a key is its own: `ArrowUp` is written `UP`, `ARROW UP`, `↑`
// or `▲` on real screens, and all of them name the key. The patterns below accept
// each of those, over the frame's text with case folded away, so the check is on
// whether the key is named rather than on how.
//
// The screen is reached through the surface, so a build whose title menu cannot
// open it fails `states/howto-reachable` alone rather than this as well.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseScene,
  type Dir,
  type Harness,
} from "../harness";

/**
 * How each steering direction's two bound keys may be named on a screen.
 *
 * The letter half is the `WASD` binding written as a word of its own; the rest
 * is the arrow half, named or drawn as its glyph.
 */
const NAMES: Readonly<Record<Dir, RegExp>> = {
  up: /\bW\b|\bUP\b|ARROW|[↑▲⬆]/,
  down: /\bS\b|\bDOWN\b|ARROW|[↓▼⬇]/,
  left: /\bA\b|\bLEFT\b|ARROW|[←◀⬅]/,
  right: /\bD\b|\bRIGHT\b|ARROW|[→▶➡]/,
};

/** The second key each steering action is bound to, named in the verdict. */
const WASD: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[1],
  down: BINDINGS.down[1],
  left: BINDINGS.left[1],
  right: BINDINGS.right[1],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names a bound key for each of the four steering directions", async () => {
  const howto = poseScene(h, { screen: "howto" });
  assertEqual(howto.screen, "howto", "the screen the frame is read from");

  const calls = await h.frameCalls();
  captureStill(h, "howto");

  const text = drawnText(calls).join(" ").toUpperCase();
  for (const dir of Object.keys(NAMES) as Dir[]) {
    assertMatches(
      text,
      NAMES[dir],
      `the how-to screen naming ${WASD[dir]} or the ${dir} arrow`,
    );
  }
});
