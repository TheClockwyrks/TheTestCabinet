// controls/repeat-arms-no-edge — a repeat key event arms no edge.
//
// WHAT THIS DECIDES. One thing: the auto-repeat `keydown` a browser sends while
// a key is held is not a press. Dispatched on the title while `ArrowDown` is
// already down, a `keydown` with `repeat` set moves the highlight no further.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Where input comes from"): "A key event whose `repeat`
//   flag is set arms no edge", beside the edge rule itself, "true once for the
//   frame in which the held value went from `0` to `1`".
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down` move
//   the highlight, wrapping at both ends".
//   specs/instrumentation.md ("What the runtime provides instead"): "a
//   dispatched keyboard event moves the lamplighter and works the menus exactly
//   as a player's key does", which is what lets the repeat be dispatched at all,
//   since Chromium decides its own `repeat` flags.
//
// THE DRIVE. From the `title` the harness's opening `reset` left, a REAL
// `ArrowDown` goes down and one frame runs: the press that moves the highlight
// to `1`, read back as the precondition. With the key still down, a
// `KeyboardEvent` built by the harness — `code` and `key` `ArrowDown`, `repeat`
// `true` — is dispatched where a typed key lands, and one more frame runs. The
// menu has two items, so a second move would read `0`.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  dispatchKey,
  type Harness,
} from "../harness";

/** The first key bound to `down`. */
const DOWN_KEY = BINDINGS.down[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the title highlight where a repeat keydown found it", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the key is held on");
  assertEqual(title.menuIndex, 0, "the highlighted item before the press");

  await h.hold(DOWN_KEY);
  let after;
  try {
    const pressed = await h.step(1);
    assertEqual(pressed.menuIndex, 1, "menuIndex after the press that held");

    await dispatchKey(h, "keydown", DOWN_KEY, { repeat: true });
    after = await h.step(1);
  } finally {
    await h.release(DOWN_KEY);
  }
  await captureStill(h, "repeat");

  assertEqual(after.screen, "title", "the screen after the repeat event");
  assertEqual(
    after.menuIndex,
    1,
    "menuIndex after a repeat keydown of ArrowDown",
  );
});
