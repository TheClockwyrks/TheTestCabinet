// audio/no-place-cue-on-a-tray-drag-that-places-nothing — a tray drag that adds
// nothing to the machine sounds nothing.
//
// THE RULE. The cue's event is a part placed or moved: "| `place` | `CUES.place`
// | A part is placed or moved. |" (`specs/ui.md`). A drag that places nothing has
// not had that event, and `specs/editor.md` names the two ways a tray drag ends
// that way: "Releasing on a legal hex places it and selects it; RELEASING
// ANYWHERE ELSE PLACES NOTHING", and "A release while no hex is targeted commits
// no move and leaves the part in place, selected. A TRAY DRAG RELEASED THE SAME
// WAY PLACES NOTHING."
//
// THE CONFIGURATION. `BARE` in the editor with ONE arm anchored on `ORIGIN`
// through the surface, and two gestures over it, each from the middle of tray
// entry `0`, which is `arm`:
//
//   * a release on `ORIGIN` itself, which breaks placement rule 4 — "No two arms
//     or wheels share an anchor hex" — and nothing else: the hex is on the field,
//     no footprint and no track is near it, and no rise or set is placed. The
//     placement oracle of `specs/parts.md` names that rule before the gesture, so
//     what makes the release illegal is the specification rather than the build's
//     opinion.
//   * a release at `OFF_EVERY_HEX`, a point inside the field region and more than
//     `HEX_HIT_R` (`26`) from every hex centre, so `specs/field.md` targets no
//     hex there. The field oracle says so before the gesture.
//
// BOTH GESTURES ARE SHOWN TO HAVE BEEN LIVE. Each moves onto a hex first, where
// `editor.drag` reports a live place drag, so a build that never began a drag at
// all fails here rather than passing this point by ignoring the tray.
//
// THE VERDICT. The machine holds the one arm it began with after each gesture,
// and no frame between the watcher's opening and the end of the run of frames
// after the second release sounds anything at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { CUES } from "../constants";
import { hexCenter, targetHex, traySlot, type StagePoint } from "../field";
import { armPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureReplay,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  partIds,
  placePart,
  pressAt,
  releasePointer,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

/** A point inside the field region and more than `HEX_HIT_R` from every centre. */
const OFF_EVERY_HEX: StagePoint = { x: 940, y: 304 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing for a release on an illegal hex or on no hex at all", async () => {
  const arm = armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []);
  assertEqual(
    placementFault([arm, arm], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on the origin's anchor break placement rule 4 and nothing else",
  );
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "no field hex centre lies within HEX_HIT_R of the second release point",
  );

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await placePart(h, "arm", ORIGIN);
  const before = await partIds(h);
  assertLength(before, 1, "one arm stands on the origin before either gesture");

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);

  const drags = await captureReplay(h, "silent", async () => {
    // The release on the occupied anchor: illegal, so it places nothing.
    await pressAt(h, centerOf(traySlot(ARM_SLOT)));
    await moveTo(h, hexCenter(ORIGIN));
    const onOrigin = (await h.snapshot()).editor.drag;
    await releasePointer(h);
    await h.advance(FENCE_FRAMES);

    // The release over no hex at all: nothing is targeted, so nothing is placed.
    await pressAt(h, centerOf(traySlot(ARM_SLOT)));
    await moveTo(h, hexCenter(ORIGIN));
    await moveTo(h, OFF_EVERY_HEX);
    const offField = (await h.snapshot()).editor.drag;
    await releasePointer(h);
    await h.advance(TAIL_FRAMES);
    return { onOrigin, offField };
  });

  assertEqual(
    drags.onOrigin?.kind,
    "place",
    "the press in the tray opened a place drag, which the release on the occupied anchor then refuses",
  );
  assertNotNull(
    drags.offField,
    "the second gesture's drag is live at the moment of the release",
  );
  assertNull(
    drags.offField?.kind === "place"
      ? drags.offField.at
      : "no place drag was live",
    "the drag targets no hex at the moment of the second release",
  );
  assertLength(
    await partIds(h),
    1,
    "neither release placed anything: the machine is the one arm it began with",
  );
  assertLength(
    soundingFrames(heard, CUES.place),
    0,
    "a tray drag that places nothing has not had the place cue's event, so no frame sounds it",
  );
});
