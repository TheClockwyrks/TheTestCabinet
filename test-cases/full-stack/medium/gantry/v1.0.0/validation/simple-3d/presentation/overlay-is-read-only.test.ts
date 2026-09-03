// presentation/overlay-is-read-only — showing the debug overlay leaves the game
// exactly as it was.
//
// `specs/instrumentation.md` § Diagnostics: "Keep each one short enough to read
// on a line, and KEEP EVERY SOURCE A PURE READ, so watching the overlay leaves
// the game as it is." A panel that stepped the game, moved the camera or picked
// something on its way to reading it would make the overlay a control rather than
// a window.
//
// THE READING IS THE STATE, WHICH IS THE WHOLE OF THE REQUIREMENT. Nothing about
// the panel's appearance is asked here — what it must not do is change anything
// — so the snapshot is taken, the overlay is shown, and the snapshot is taken
// again. `specs/instrumentation.md` fixes the key: the backtick, `Backquote`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The key the overlay is shown and hidden by (`specs/instrumentation.md`). */
const TOGGLE = "Backquote";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing about the game when the overlay is shown", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.advance(1);

  const before = await h.snapshot();
  await h.press(TOGGLE);
  await h.advance(1);
  const after = await h.snapshot();

  await h.capture("read-only", "The game with the overlay shown");

  // The frame counter and the clock move because a frame was run, and nothing
  // else may: the comparison is of everything the game holds, with the two
  // readings taken a known number of frames apart.
  assertEqual(
    JSON.stringify({ ...after, simTime: 0 }),
    JSON.stringify({ ...before, simTime: 0 }),
    "the game across showing the overlay (specs/instrumentation.md)",
  );
});
