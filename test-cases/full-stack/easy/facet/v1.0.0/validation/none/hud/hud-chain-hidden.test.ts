// Facet — hud/hud-chain-hidden: while the board is idle, the playing screen
// draws no CHAIN readout.
//
// specs/ui.md gives the chain readout the one condition no other readout on the
// `playing` screen carries: `HUD_CHAIN_LABEL` (`CHAIN`) is "shown while
// `state.phase` is `resolving` and absent while it is `idle`". The absence is
// the requirement here — a build that leaves the label standing over a settled
// board tells a player a chain is running when none is, and the readout stops
// meaning anything at all.
//
// THE ANTECEDENT. The harness's `loadBoard` poses a board on `playing`
// with `phase` `idle`, `chainStep` and `stepTimer` at `0`, and specs/rules.md
// has a posed board rest exactly as written until a swap is accepted on it. So
// the quiet filler, on which no swap is even productive, is a settled board
// that stays settled: the one frame driven below cannot open a chain, and the
// snapshot taken beside it says the phase it was drawn at.
//
// THE READING IS AN ABSENCE, so it is guarded against answering `false` for the
// wrong reason. `showsText` searches a frame's whole run of text, and a run
// with nothing in it finds nothing — which would make a build that drew no
// frame at all look like a build that correctly hid one label. The frame is
// therefore required to have put text on screen before the absence is read, so
// a silent render fails as the empty frame it is rather than passing as a
// hidden readout.
//
// The copy is read through `frameText`, which gathers a frame's canvas text and
// the page's own DOM text alike, because specs/assets.md has an engineless
// build draw its chrome "in code (canvas or DOM)" and this point is not about
// which of the two it chose. Its DOM half reads what is RENDERED, so an element
// the build keeps in the document and hides while the board is idle has shown a
// player nothing and is read as nothing — which is what specs/ui.md asks for,
// the label "shown while `state.phase` is `resolving` and absent while it is
// `idle`".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { quietBoard } from "../board";
import { HUD_CHAIN_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no chain label while the board is idle", async () => {
  await loadBoard(h, quietBoard());

  // The antecedent: the settled board this point is about.
  const posed = await h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the readouts sit on");
  assertEqual(posed.phase, "idle", "the phase a posed board rests in");
  assertEqual(posed.chainStep, 0, "the chain step of a settled board");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "hud");
  assertEqual((await h.snapshot()).phase, "idle", "the phase it was read at");

  // The frame drew something, so the absence below is a reading of the screen
  // rather than a reading of nothing.
  if (drawn.length === 0) {
    fail("the playing screen to put text on the frame", drawn);
  }

  if (showsText(drawn, HUD_CHAIN_LABEL)) {
    fail(
      `the idle playing screen not to show ${JSON.stringify(HUD_CHAIN_LABEL)}`,
      drawn,
    );
  }
});
