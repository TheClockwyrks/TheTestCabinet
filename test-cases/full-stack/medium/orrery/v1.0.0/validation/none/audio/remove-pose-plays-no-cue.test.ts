// audio/remove-pose-plays-no-cue — `removePart` takes a part off the machine and
// sounds nothing.
//
// THE RULE. "Audio belongs to the frames. A pose changes the state alone and
// SOUNDS NOTHING, the pointer operations included; the cues a scenario hears come
// from the frames advanced after it" (`specs/instrumentation.md`, A deterministic
// core). `removePart(part)` is a row of that surface's machine group — "Removes
// one placed part, discarding its tape and its tape-panel row exactly as
// `part-delete` does" — and it is a pose like every other one there.
// `CUES.erase` is the cue of the player's own removal: "`erase` | `CUES.erase` |
// A part is removed" (`specs/ui.md`), played "on the frame its event happens",
// and the deferral the specification grants is granted to the pointer's edits
// alone.
//
// THE SILENCE IS READ TWICE, at the call and over the frames advanced afterwards,
// where a cue the pose had merely deferred would arrive. The editor holds no run,
// and the machine is the two parts this check placed, so nothing else has an
// event to sound on.
//
// AND THE READING IS SHOWN TO WORK. A build the harness cannot hear would pass a
// silence check by being silent, so the check closes by removing the OTHER part
// the way a player removes one — `part-delete` on the selection, which
// `specs/controls.md` binds to `KeyX` under field focus — and reads the count
// move.
//
// THE VERDICT. `removePart` took the part off the machine; nothing sounded at the
// call or on the frames after it; and `part-delete`, over the same build, sounds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  openTitle,
  partById,
  placePart,
  pressAction,
  watchCues,
  type Harness,
} from "../harness";
import { openSilence } from "./silence";

/** Frames advanced after the pose, where a deferred cue would arrive. */
const AFTER = 6;

/** Where the second arm stands: a hex clear of the first. */
const BESIDE = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a placed part from code without sounding an erase cue", async () => {
  await openTitle(h);
  await openSilence(h);

  await openChallengeDocument(h, BARE);
  const posed = await placePart(h, "arm", ORIGIN, 0);
  const spare = await placePart(h, "arm", BESIDE, 0);
  await h.advance(2);

  const played = watchCues(h);
  const before = await h.sounds();

  const removed = await captureReplay(h, "silent", async () => {
    await h.debug.removePart(posed);
    const after = await h.snapshot();
    const reading = { sounded: await h.sounds(), stamped: played.length };

    // Only now, past the reading, are the frames run a deferred cue would land on.
    await h.advance(AFTER);
    return { after, reading };
  });

  assertNull(
    partById(removed.after, posed),
    "removePart took the part off the machine, so the silence is a silence over a real removal",
  );
  assertEqual(
    removed.after.editor.parts.length,
    1,
    "and left the other part standing",
  );
  assertEqual(
    removed.reading.sounded,
    before,
    "removePart sounds nothing at the call: a pose changes the state alone",
  );
  assertEqual(
    removed.reading.stamped,
    0,
    "and no cue was attributed to a frame, because no frame ran",
  );
  assertEqual(
    await h.sounds(),
    before,
    "and none arrived on the frames advanced afterwards either: no CUES.erase is deferred out of a pose",
  );

  // The control: the same removal made the player's way does sound.
  await h.debug.setSelected(spare);
  await h.debug.setFocus("field");
  await pressAction(h, "part-delete");
  await h.advance(2);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    0,
    "part-delete removed the selected part, which is the event CUES.erase is the cue of",
  );
  assertGreaterThan(
    await h.sounds(),
    before,
    "and the same build sounds for it, so the silence above is the pose's rather than a build that cannot be heard",
  );
});
