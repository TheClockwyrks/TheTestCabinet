// audio/foe — a bolt destroying a foe sounds a cue on the frame the foe leaves
// the roster, and the flight before it stays silent.
//
// `specs/ui.md`'s cue table: `foe` is played when "A foe is destroyed", and every
// cue "is played on the frame its event happens and at most once on that frame".
// `specs/cursor.md` fixes the event: a bolt resolves against "a foe" when "the
// bolt's center is inside the foe's box, `FOE_HALF` (`12`) units from the foe's
// center on each axis", and `specs/foes.md` gives the glitch as the foe that
// takes exactly `1` bolt.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE GLITCH IS POSED WITH BOTH ITS FACULTIES OFF, and that is isolation rather
// than convenience. Its travel would carry it out of the bolt's column while the
// bolt climbed, so the shot would be deciding `foes/glitch-descends` as much as
// the cue; its mind would eat the tile it stands on, which on this board holds
// nothing but would put a second event inside the window. `specs/instrumentation.md`
// states each gate as gating that one faculty and nothing else, so what is left
// is a foe standing still to be shot — which is the whole of what this point is
// about.
//
// The glitch is the only thing on the board: no node, no worm, no other foe, and
// the three world gates shut, so no other cue of the ten has an event to answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseBolt,
  poseFoe,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { framesOtherThan, soundsOn } from "./cues";

/** The tile the glitch stands on, clear of the entry row and the player band. */
const FOE = { c: 12, r: 8 } as const;

/** Quiet play driven before the bolt is put in flight, in frames. */
const QUIET_FRAMES = framesFor(0.3);

/** A ceiling on a build whose shot never resolves, not a tolerance on when it does. */
const NEVER_RESOLVED = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the foe leaves the roster, and on no other frame", async () => {
  await startPlaying(h);
  await poseFoe(h, "glitch", FOE.c, FOE.r, { mind: false, travel: false });

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  await poseBolt(h, FOE.c, FOE.r + 1);
  const killed = await h.until((snapshot) => snapshot.foes.length === 0, {
    maxFrames: NEVER_RESOLVED,
    poll: 1,
  });
  // Read HERE, on the frame the foe left the roster.
  const killFrame = h.frame();
  const heard = [...played];

  await captureStill(h, "kill");

  assertEqual(killed.hit, true, "the bolt to destroy the glitch");
  assertGreaterThan(
    soundsOn(heard, killFrame),
    0,
    `sounds emitted on frame ${killFrame}, the frame the foe left the roster`,
  );
  assertDeepEqual(
    framesOtherThan(heard, killFrame),
    [],
    "the frames of every sound emitted away from the kill",
  );
});
