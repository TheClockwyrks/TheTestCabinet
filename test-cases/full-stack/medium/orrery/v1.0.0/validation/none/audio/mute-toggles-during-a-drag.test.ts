// audio/mute-toggles-during-a-drag — the editor reads mute while a drag is live,
// and the drag survives it.
//
// THE RULE. `specs/editor.md` closes the list of what a live gesture is allowed
// to hear with this cue's action: "While a drag or lay is live THE ONLY ACTIONS
// THE EDITOR READS are `part-cw`, `part-ccw`, `part-grow`, and `part-shrink`,
// which act on the ghost, AND `mute`. A drag ends at its release." So `mute` is
// one of the five, and the sentence after it says what must still be true when
// the press is over: a drag ends at its RELEASE, and no key ends it. That agrees
// with the binding, which is global — "`mute` | `KeyM` | Toggles sound, from any
// screen" (`specs/controls.md`) — and with `specs/ui.md`, which has the game
// "toggle it from any screen, then mirror that bit into `state.muted` every
// frame".
//
// THE WORLD. A part placed in the editor and then GRABBED: a pointer press on its
// hex and a move onto another, with no release. The three pointer operations
// "take effect immediately, when they are called" and "feed the same input path
// the player's pointer feeds: targeting, selection, drags, lays, and the focus
// rule all run as `specs/editor.md` and `specs/controls.md` state"
// (`specs/instrumentation.md`), so what stands when they return is a live `move`
// drag — which the snapshot reports as `editor.drag`.
//
// THE VERDICT. `muted` is `true` in the snapshot after the press, and
// `editor.drag` is still the same live move drag, on the same part, targeting the
// same hex. The release afterwards is what ends it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  openTitle,
  placePart,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The hex the drag is holding the part over when the key is pressed. */
const OVER = at(1, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports muted true mid-drag and leaves the drag live", async () => {
  await openTitle(h);

  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.advance(1);

  const dragged = await captureReplay(h, "dragging", async () => {
    await pressAt(h, hexCenter(ORIGIN));
    await moveTo(h, hexCenter(OVER));
    const before = await h.snapshot();
    const after = await pressAction(h, "mute");
    await releasePointer(h);
    const released = await h.snapshot();
    return { before, after, released };
  });

  assertNotNull(
    dragged.before.editor.drag,
    "the press and the move left a live drag, which is the world this point reads",
  );
  assertEqual(
    dragged.before.editor.drag?.kind,
    "move",
    "a press on a placed part's hex grabs it, so the live gesture is a move drag",
  );
  assertEqual(
    dragged.before.muted,
    false,
    "sound is on before the press, so what is read after it is the press's own work",
  );

  assertEqual(
    dragged.after.muted,
    true,
    "the mute action pressed while a drag is live reports muted true in the next snapshot",
  );
  assertNotNull(
    dragged.after.editor.drag,
    "and leaves the drag live: mute is one of the five actions the editor reads then, and a drag ends at its release",
  );
  assertEqual(
    dragged.after.editor.drag?.kind,
    "move",
    "still the same move drag",
  );
  assertEqual(
    dragged.after.editor.drag?.kind === "move"
      ? dragged.after.editor.drag.part
      : null,
    arm,
    "on the same part",
  );
  assertEqual(
    dragged.after.editor.drag?.kind === "move"
      ? `${dragged.after.editor.drag.at?.q},${dragged.after.editor.drag.at?.r}`
      : null,
    `${OVER.q},${OVER.r}`,
    "targeting the same hex it was over when the key was pressed",
  );

  assertNull(
    dragged.released.editor.drag,
    "and the release is what ends it, as specs/editor.md states",
  );
});
