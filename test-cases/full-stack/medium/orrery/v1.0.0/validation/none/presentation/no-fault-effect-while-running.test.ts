// presentation/no-fault-effect-while-running — a machine that is running well
// plays nothing.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Fault |
// `assets/particles/fault.json` | the position of the mote THE FAULT of
// `specs/simulation.md` names ... or the anchor hex of the part it names when it
// names no mote." The effect is fired at a fault, so where there is no fault there
// is nothing to fire: `specs/simulation.md` makes `sim.fault` "What stopped a run",
// `null` while none has, and a run whose status is `running` has not stopped.
//
// HOW "NOTHING WAS PLAYED" IS READ. Not as pixels, because `specs/ui.md` fixes no
// background — "Orrery fixes no palette, no font, and no background" — so a build
// whose sky glitters is conformant and its pixels move on their own. What an effect
// adds is DRAWING: a system's particles are composited onto the frame, so a frame
// carrying one issues operations a frame without one does not. `drawing.ts` counts
// exactly that, and its counts are "Enough of a count to compare two frames of the
// same scene: a frame that drew a highlight, a ghost, a marked cell or an effect
// asked for strictly more of these than the same frame without it, whatever shape
// the build chose to draw it as."
//
// TWO READINGS OF THAT COUNT, BECAUSE ONE OF THEM CANNOT ALWAYS FIRE. The first is
// the item's own: every frame of the stretch is compared against the frame the same
// drive produced with `assets/particles/fault.json` UNAVAILABLE. A build that plays
// the fault system through a clean run draws more in the run that has the file than
// in the run that does not. A build that inlined the document into its bundle —
// which is conformant, and which `assets/degraded.ts` sets out — makes no request to
// refuse, so both runs are the same build and that comparison says only that the two
// runs agree. The second reading covers that case: every frame draws exactly what
// the FIRST frame of the same run drew, so anything an effect added part-way through
// the stretch is a difference, and there is none.
//
// THE WORLD IS POSED SO THAT THE COUNTS CANNOT MOVE FOR ANY OTHER REASON. The
// machine is one arm with a blank tape, "which every part rests on"
// (`specs/instrumentation.md`) and which "is a rest on every part ... and never
// faults" (`specs/simulation.md`). The field is empty of motes, so nothing is
// carried, nothing collides and nothing is banked into a picture. No rise and no
// set is placed, so no aperture turns and no set can consume and raise a delivery.
// The completion switch is held off by the bare opener, so the run cannot complete
// and raise that effect either. Every frame of the stretch therefore draws the same
// scene, and the only thing that could add to it is an effect that should not be
// there.
//
// THE STRETCH IS TWELVE CYCLES, watched two frames at a time, and the run's status
// and fault are read on every one of them, so the premise of the point — "with
// `sim.status` running and `sim.fault` null" — is checked rather than assumed. Both
// runs are driven identically, frame for frame, from the same opener.
//
// THE VERDICT. Across the whole stretch the run is running and unfaulted, and every
// frame issues exactly the drawing operations, image draws and distinct sources both
// the first frame of the run and the same frame of the run without the fault system
// issued.
//
// THE EVIDENCE is the clean stretch itself, recorded as it is driven.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  distinctSources,
  drawOps,
  imageDraws,
  openBareRun,
  type DrawCall,
  type Harness,
} from "../harness";
import { withoutFile } from "../assets/degraded";
import { PARTICLE_FILES } from "../assets/files";

/** How many cycles the running machine is watched over. */
const CYCLES = 12;

/** How many frames each of those cycles is divided into. */
const FRAMES_PER_CYCLE = 2;

/** The pattern that withholds the fault system, under all three engines. */
const WITHHELD = withoutFile(PARTICLE_FILES.fault);

/** What a frame drew, as three counts nothing but an addition to the picture moves. */
interface Shape {
  ops: number;
  images: number;
  sources: number;
}

/** What one run of the stretch hands back: what each of its frames drew. */
interface Watched {
  first: Shape;
  frames: Shape[];
}

function shapeOf(calls: readonly DrawCall[]): Shape {
  return {
    ops: drawOps(calls),
    images: imageDraws(calls).length,
    sources: distinctSources(calls).length,
  };
}

/**
 * Open the bare run on one arm resting on a blank tape, drive the stretch, and
 * keep what every frame of it drew.
 *
 * `capture` is the output id under the run that HAS the fault system, and null
 * under the run that does not, so the evidence a reviewer opens is the stretch the
 * point is about rather than the control beside it.
 */
async function watch(h: Harness, capture: string | null): Promise<Watched> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });

  await h.advance(1);
  const first = shapeOf(await h.lastCalls());

  const opened = await h.snapshot();
  assertEqual(opened.sim?.status, "running", "the run is live and running");
  assertNull(opened.sim?.fault, "and nothing has faulted it");
  assertEqual(
    (opened.sim?.motes ?? []).length,
    0,
    "the field is empty, so nothing on it can move, collide or be delivered",
  );

  const frames: Shape[] = [];
  const drive = async (): Promise<void> => {
    for (let frame = 0; frame < CYCLES * FRAMES_PER_CYCLE; frame += 1) {
      await advanceCycles(h, 1 / FRAMES_PER_CYCLE, 1);

      const now = await h.snapshot();
      assertEqual(
        now.sim?.status,
        "running",
        "the run is still running, so the stretch is the one the point is about",
      );
      assertNull(now.sim?.fault, "and sim.fault is still null across it");

      frames.push(shapeOf(await h.lastCalls()));
    }
  };
  if (capture === null) await drive();
  else await captureReplay(h, capture, drive);

  const ended = await h.snapshot();
  assertEqual(
    ended.sim?.cycle,
    CYCLES,
    "the stretch really covered twelve whole cycles of the running machine",
  );
  return { first, frames };
}

let h: Harness;
let bare: Harness;

beforeEach(async () => {
  h = await createHarness();
  bare = await createHarness({ withoutAssets: WITHHELD });
});

afterEach(async () => {
  await h.dispose();
  await bare.dispose();
});

it("draws exactly the same operations on every frame of a clean run", async () => {
  const played = await watch(h, "no-fault-effect");
  const withheld = await watch(bare, null);

  assertGreaterThan(
    played.first.ops,
    0,
    "the first frame of the run draws something, so the counts below mean something",
  );
  assertEqual(
    withheld.frames.length,
    played.frames.length,
    "the run with the fault system unavailable was driven over the same stretch, frame for frame",
  );

  for (let frame = 0; frame < played.frames.length; frame += 1) {
    const shape = played.frames[frame] as Shape;
    const control = withheld.frames[frame] as Shape;

    assertEqual(
      shape.ops,
      control.ops,
      `frame ${frame + 1} of a run with no fault draws what the same drive draws with ` +
        "assets/particles/fault.json unavailable, so the fault effect marks a fault " +
        "rather than playing throughout the run",
    );
    assertEqual(
      shape.images,
      control.images,
      `frame ${frame + 1} adds no image draw the run without the fault system made, ` +
        "which is how a composited system reaches a frame",
    );
    assertEqual(
      shape.sources,
      control.sources,
      `frame ${frame + 1} draws no source the run without the fault system drew`,
    );

    assertEqual(
      shape.ops,
      played.first.ops,
      `frame ${frame + 1} adds no drawing operation to the picture the first frame drew`,
    );
    assertEqual(
      shape.images,
      played.first.images,
      `frame ${frame + 1} adds no image draw to the ones the first frame made`,
    );
    assertEqual(
      shape.sources,
      played.first.sources,
      `frame ${frame + 1} draws no source the first frame did not`,
    );
  }
});
