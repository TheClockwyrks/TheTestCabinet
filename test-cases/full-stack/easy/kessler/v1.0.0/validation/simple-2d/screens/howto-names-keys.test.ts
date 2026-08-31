// screens/howto-names-keys — how to play names the keys.
//
// specs/screens.md, on `howto`: it covers "the controls, naming the keys bound
// to each action in `specs/controls.md`", "written in a player's words rather
// than as rules of a system" — so a player reads the controls off the screen.
//
// The copy is the build's to write, so each action passes when the frame names
// at least one of its bound keys in any spelling a player would read it by:
// the four directional actions are all named by "arrow"/the glyphs, by the
// WASD cluster, or by the code spelling the specs table itself uses (KeyA),
// and the rest by their key's name in either spelling.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  drawnText,
  openHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** For each action, the spellings that count as naming one of its keys. */
const NAMED: readonly (readonly [string, RegExp])[] = [
  ["left (ArrowLeft / KeyA)", /arrow|\u2190|wasd|keya|\ba\s*\/\s*d\b/u],
  ["right (ArrowRight / KeyD)", /arrow|\u2192|wasd|keyd|\ba\s*\/\s*d\b/u],
  ["up (ArrowUp / KeyW)", /arrow|\u2191|wasd|keyw|\bw\s*\/\s*s\b/u],
  ["down (ArrowDown / KeyS)", /arrow|\u2193|wasd|\bw\s*\/\s*s\b/u],
  ["confirm (Space / Enter)", /space|enter|return/],
  ["launch (Space)", /space/],
  ["back (Escape)", /esc/],
  ["pause (KeyP)", /\bp\b|keyp/],
];

it("names a key for every action on the how-to frame", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the copy is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "howto");

  const text = drawnText(calls).join(" ").toLowerCase();
  for (const [action, key] of NAMED) {
    assertMatches(text, key, `the how-to copy naming a key for ${action}`);
  }
});
