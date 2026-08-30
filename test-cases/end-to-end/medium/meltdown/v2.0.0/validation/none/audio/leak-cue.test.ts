// audio/leak-cue — a unit walking out through its own exhaust sounds a cue on the
// frame it leaves, and the quiet floor it crossed to get there stays silent.
//
// `specs/audio.md`'s cue table: `leak` answers "A surge unit reaches its assigned
// exhaust", and every cue is "raised by the frame that resolves the event it
// answers". `specs/mazing.md` fixes that frame: "A unit leaves the floor when the
// tile its centre occupies is one of the opening tiles of its assigned exhaust",
// and `specs/surge.md` has it "removed from the floor on the frame" that happens,
// costing "[i]ts leak value in lives".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and its
// frame can be read from outside an engineless build, the cue's NAME cannot. So
// this point separates a build that cues the leak from one that cues nothing, one
// that cues a frame late, and one that blips every frame.
//
// THE LEAK IS THE ONLY EVENT IN THE WINDOW, and the floor is what makes that true.
// `startRun` empties both rosters, shuts the world gate and leaves a live BUILD
// phase — so nothing arrives on its own, no tower fires, nothing can die, and a
// build phase releases no unit and therefore never clears (`specs/waves.md`),
// which keeps the wave-clear cue out of reach. One Mote enters at the left vent
// under its own power and is stood on the last tile before the right exhaust,
// which `specs/floor.md` fixes as that vent's opposite. It walks the single step
// its own locomotion takes.
//
// THE LIVES ARE THE RUN'S OWN, WHICH IS WHY THE LEAK CANNOT END THE RUN. A
// Containment run opens on `START_LIVES` (`20`) and a Mote's leak costs `1`
// (`specs/surge.md`), so the lives that leak leaves are far above `0` and the
// game-over cue — which `specs/waves.md` puts on the frame lives reach `0` — has
// nothing to answer. `audio/game-over-cue` is the point that poses the other side
// of that.
//
// THE TILE IT IS STOOD ON IS ORDINARY FLOOR, not an opening tile: a unit already
// standing in the opening would have left before the drive opened a frame, and
// `frameWhere` refuses that rather than crediting the leak to a frame that never
// ran.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseWalker,
  requireUnit,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { SURGE_DEFS } from "../constants";
import { framesOtherThan, leakOut, poseAtExhaustDoor, soundsOn } from "./cues";

/** The unit the leak is read on: the baseline of the roster (`specs/surge.md`). */
const TYPE = "mote" as const;

/** The vent it enters at; `specs/floor.md` fixes the exhaust it is assigned. */
const VENT = "left" as const;

/** What that unit's escape costs in lives (`specs/surge.md`). */
const LEAK_COST = SURGE_DEFS[TYPE].leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the unit leaves through its exhaust, and on no other", async () => {
  await startRun(h);
  const unit = await poseWalker(h, TYPE, VENT);
  const entered = requireUnit(await h.snapshot(), unit, "the walker");
  const door = await poseAtExhaustDoor(h, unit, entered.exhaust);
  const before = await h.snapshot();
  const posed = requireUnit(before, unit, "the posed walker");
  const livesBefore = before.lives;
  await h.armAudio();

  // Watched after the walker is stood on the floor, so the frames it spends
  // crossing the last tile are part of what is read.
  const played = watchCues(h);
  const leak = await leakOut(h, "the leak");
  const leakFrame = leak.frame;
  const heard = [...played];

  await captureStill(h, "leak");

  assertEqual(
    posed.col,
    door.col,
    "the column the walker was stood in, one tile inside its exhaust",
  );
  assertEqual(posed.row, door.row, "the row the walker was stood in");
  assertEqual(posed.motion, true, "the walker's own locomotion, left running");
  assertEqual(leak.hit, true, "the walker to reach its exhaust and leave");
  assertEqual(
    leak.snapshot.lives,
    livesBefore - LEAK_COST,
    `the lives left once a ${TYPE} escaped, from ${livesBefore}`,
  );
  assertGreaterThan(
    leak.snapshot.lives,
    0,
    "the lives still standing, so the leak ended no run",
  );

  assertGreaterThan(
    soundsOn(heard, leakFrame),
    0,
    `sounds emitted on frame ${leakFrame}, the frame the unit left the floor`,
  );
  assertDeepEqual(
    framesOtherThan(heard, leakFrame),
    [],
    "the frames of every sound emitted away from the leak",
  );
});
