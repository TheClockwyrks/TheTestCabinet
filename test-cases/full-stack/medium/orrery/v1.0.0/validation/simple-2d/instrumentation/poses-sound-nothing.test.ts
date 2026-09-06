// instrumentation/poses-sound-nothing — a pose changes the state and sounds
// nothing, the pointer included.
//
// THE RULE. "Audio belongs to the frames. A pose changes the state alone and
// sounds nothing, the pointer operations included; the cues a scenario hears come
// from the frames advanced after it" (`specs/instrumentation.md`, A render-free
// core). The two groups that would sound something say it again where a reader
// would look for it: Navigation, "No cue sounds at the call, as the render-free
// core above states", and The editor's hands, "The three sound nothing at the call,
// as every pose does. The cue of an edit one of them commits sounds on the next
// frame advanced, because every cue of `specs/ui.md` is played from a frame."
// `specs/ui.md` closes it: "Every cue is played from a frame, so an event raised
// outside one — an edit a pointer pose of `specs/instrumentation.md` commits
// between frames — sounds on the next frame advanced rather than at the call."
//
// THE POSE IS A WHOLE MACHINE AND A WHOLE RUN, WITH NO FRAME IN IT. Every call
// between the two readings is a pose, and several of them are exactly the events
// `specs/ui.md` names a cue for: a part placed (`place`), a part moved by a real
// pointer drag (`place` again, and this one is an edit the POINTER committed), and
// a run started (`start`). If any of the three sounded at the call rather than on a
// frame, the count moves.
//
// THE READING IS THE BUILD'S TOTAL, NOT A PER-FRAME SINK. `watchCues` stamps a cue
// with the frame it sounded on and no frame runs here, so a sink alone would be
// empty however loud the build was; `Harness.sounds()` is the count of everything
// the build has emitted since it stood up and answers at any moment, which is what
// makes the silence readable between two frames. Both are read, and the sink is
// there to catch a cue attributed to a frame that never ran.
//
// AND THE READING IS SHOWN TO WORK. The same count, over the same build, moves as
// soon as frames are advanced over exactly the events the poses raised — which is
// the specification's own "the cues a scenario hears come from the frames advanced
// after it", and is what stops a build the harness simply cannot hear from passing
// this point by being inaudible.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { at, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openTitle,
  watchCues,
  type Harness,
} from "../harness";

/** Where the placed arm is dragged to: a hex clear of everything the check poses. */
const MOVED_TO = at(1, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a machine and starts a run from code without sounding a cue", async () => {
  await openTitle(h);
  await h.armAudio();
  await h.advance(2);

  const silent = await captureReplay(h, "silent", async () => {
    // The run-up is taken BEFORE the cue window opens, so the frames that make the
    // recording watchable are not frames this point counts sound over: what the
    // window holds is the poses and nothing else.
    await h.advance(RECORDING_RUN_UP);
    const heard = watchCues(h);
    const before = await h.sounds();

    // Every call from here to the reading is a pose. No frame is advanced.
    await h.debug.loadChallenge(BARE);
    await h.debug.clearMachine();
    await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
    const placed = (await h.snapshot()).editor.parts;
    const arm = placed[placed.length - 1]?.id ?? -1;
    await h.debug.setTapeCell(arm, 0, "grab");
    await h.debug.setSelected(arm);
    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, 0);

    // The three pointer operations, as one drag that commits a move edit.
    const from = hexCenter(ORIGIN);
    const to = hexCenter(MOVED_TO);
    await h.debug.pointerDown(from.x, from.y);
    await h.debug.pointerMove(to.x, to.y);
    await h.debug.pointerUp();

    await h.debug.setCompletion(false);
    await h.debug.startRun();
    await h.debug.clearMotes();
    await h.debug.spawnMote(ORIGIN.q, ORIGIN.r, "dust");
    await h.debug.setSpeed(0);
    await h.debug.setPaused(true);
    await h.debug.setPaused(false);

    const reading = {
      before,
      sounded: await h.sounds(),
      stamped: heard.length,
    };

    // Only now, past the reading, are the frames run that the cues belong to — and
    // they are the recording's settle as well, so what a reviewer watches is the
    // posed machine and then the run it was left in.
    await h.advance(RECORDING_SETTLE);
    return reading;
  });

  assertEqual(
    silent.sounded,
    silent.before,
    "a machine placed, dragged and run purely from code sounds none of the cues of specs/ui.md",
  );
  assertEqual(
    silent.stamped,
    0,
    "and no cue was attributed to a frame, because no frame ran",
  );

  assertGreaterThan(
    await h.sounds(),
    silent.before,
    "the same reading over the same build moves once frames are advanced: the cues a scenario hears come from the frames advanced after it",
  );
});
