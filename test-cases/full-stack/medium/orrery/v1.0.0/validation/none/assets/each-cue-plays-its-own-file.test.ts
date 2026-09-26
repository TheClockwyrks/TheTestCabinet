// assets/each-cue-plays-its-own-file — each cue is its own produced sound.
//
// THE RULE, from The sound of `specs/assets.md`: "Produce a distinct sound for
// each of the six one-shot cues below, under exactly these file names, with
// `sfx-synth` or `sfx-sample` as suits each. The event each cue plays on is fixed
// in `specs/ui.md`", and the closing line of the file: "every cue and the bed are
// produced sound. Everything the game shows and plays traces to a file produced
// here or to the chrome drawn in code above." So the sound a player hears when an
// event fires is that cue's own committed `.wav` — not another cue's clip, and
// not a tone the build synthesized at the moment of playing.
//
// THE POINT IS DECIDED IN TWO HALVES, because neither alone is the sentence.
//
//   1. EACH CUE IS HEARD ON ITS EVENT. The six events `specs/ui.md` fixes are
//      driven in turn on an untouched build — a tray placement, a part deleted, a
//      run started, a run frozen by a fault, a set consuming its product, and a
//      run completing — and each is read back as having happened before the sound
//      it raised is counted. What is counted is the build EMITTING SOUND across
//      that event's frames, which is the one reading all three engines make the
//      same way: under either engine the cue bus announces the play, and under no
//      engine the harness watches the doors a browser emits audio through.
//
//   2. AND WHAT IT PLAYS IS THAT CUE'S OWN FILE. The produced files this build
//      asked for are read back off the same run, and they name all six, one per
//      cue, at six different paths. A build that synthesized its cues instead of
//      playing the files asks for nothing; a build that shipped one clip under six
//      names asks for one file six times.
//
// WHY THE REQUESTS ARE THE READING RATHER THAN THE SOUND. Every produced file is
// served here, exactly as it is to every other check, so what a cue SOUNDS LIKE
// is never compared against a file — that is the reviewer's. What the run can
// honestly see is what the build REACHED FOR, and reaching for
// `assets/audio/halt.wav` is the whole of what binding the `halt` cue to its
// produced file means.
//
// WHAT THIS POINT DOES NOT DECIDE. Which frame a cue lands on, that it sounds at
// most once for an event, and that the right cue sounds for the right event are
// the audio category's, one point apiece. This one decides that each of the six
// is heard at all and that the sound behind it is that cue's own produced file.
//
// THE EVIDENCE is the six events driven in one recording, so a reviewer watches
// each of them happen beside the ledger the verdict read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { FRAMES_PER_CYCLE, type CueName } from "../constants";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE, EAST, ONE_DELIVERY, ORIGIN, WEST } from "../fixtures";
import {
  advanceFraction,
  allowCompletion,
  captureReplay,
  createHarness,
  dragFromTray,
  loadMachine,
  openBareRun,
  openChallengeDocument,
  partIds,
  placePart,
  placeSet,
  playAction,
  pressAction,
  resumeRun,
  spawnMote,
  tallyOf,
  writeTape,
  type Harness,
} from "../harness";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

/** Which of the challenge's products a set on `ORIGIN` receives. */
const PRODUCT = 0;

/** `ONE_DELIVERY`'s target: one accepted constellation completes the run. */
const TARGET = 1;

/** The rise for reagent `0`, the set for product `0`, and one idle arm between. */
const READY_MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

/** How many frames a cue is given to land on after the event that raised it. */
const CUE_FRAMES = 2;

/** How many quiet frames in a row {@link untilQuiet} settles for. */
const QUIET_FRAMES = 6;

/** How many frames {@link untilQuiet} spends before giving up on a noisy build. */
const QUIET_BOUND = 240;

/**
 * The produced file `CUE_PATHS` names for one cue, as a request for it looks.
 *
 * A built site is a BUNDLE, so `assets/audio/place.wav` is served under whatever
 * name the bundler emitted it as — `place-C7eSjQc3.wav` — while an engine's
 * loader is handed the authored path itself. What survives both is the cue's own
 * stem and the extension, which is what this matches.
 */
function requestFor(cue: CueName): RegExp {
  return new RegExp(`(^|/)${cue}([-.][^/]*)?\\.wav$`);
}

/**
 * Run frames until the build has stopped emitting sound, so the window each
 * event below is heard in is one that event filled.
 *
 * EXPECTS AN ARMED HARNESS — one created with `{ armAudio: true }`. A browser
 * opens no audio context without a user gesture, so an unarmed page falls quiet on
 * the first frame whatever the build is doing. The gesture cannot be made here: it
 * is a genuine key press the game is entitled to act on, and the only safe moment
 * for it is before the harness's opening `reset`.
 *
 * A build that loads its own produced bed decodes it asynchronously, so the bed
 * starts on whichever frame its file finished decoding on — a property of the
 * host rather than of the build. Nothing is asserted here: a build that never
 * falls quiet spends the bound and is heard doing so by the readings below.
 */
async function untilQuiet(h: Harness): Promise<void> {
  let quiet = 0;
  for (let frame = 0; frame < QUIET_BOUND && quiet < QUIET_FRAMES; frame += 1) {
    const before = await h.sounds();
    await h.advance(1);
    quiet = (await h.sounds()) === before ? quiet + 1 : 0;
  }
}

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because the first half of this point counts the build
  // EMITTING SOUND on each of the six events: a browser opens no audio context
  // without a user gesture, so every build is silent on an unarmed page and the
  // reading would be the host's rather than the build's. The press of `INERT_KEY`
  // goes in before the harness's opening `reset`, whose restore puts back anything
  // it touched, so each event below is still driven on an untouched build.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays each of the six cues from the file CUE_PATHS names for it", async () => {
  await captureReplay(h, "cues", async () => {
    await untilQuiet(h);

    // `place` — a part dragged out of the tray onto a legal hex.
    await openChallengeDocument(h, BARE);
    await h.debug.clearMachine();
    let opened = await h.sounds();
    await dragFromTray(h, ARM_SLOT, ORIGIN);
    await h.advance(CUE_FRAMES);
    assertLength(
      await partIds(h),
      1,
      "the release on a legal hex placed the part, which is the place cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the place cue is heard on the placement",
    );

    // `erase` — the placed part deleted.
    const placed = await partIds(h);
    await h.debug.setFocus("field");
    await h.debug.setSelected(placed[0]);
    opened = await h.sounds();
    await pressAction(h, "part-delete");
    await h.advance(CUE_FRAMES);
    assertLength(
      await partIds(h),
      0,
      "part-delete removed the selected part, which is the erase cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the erase cue is heard on the removal",
    );

    // `start` — a complete machine started by the play action.
    await openChallengeDocument(h, BARE);
    await loadMachine(h, READY_MACHINE);
    await untilQuiet(h);
    opened = await h.sounds();
    await playAction(h);
    await h.advance(CUE_FRAMES);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "running",
      "play started a run, which is the start cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the start cue is heard on the run starting",
    );

    // `halt` — a run frozen by a fault.
    await openBareRun(h, { challenge: BARE, paused: true });
    const piston = await placePart(h, "piston", ORIGIN, 0);
    await writeTape(h, piston, ["retract"]);
    await untilQuiet(h);
    opened = await h.sounds();
    await resumeRun(h);
    await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
    await h.advance(CUE_FRAMES);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "faulted",
      "retract on a piston already at ARM_MIN_LEN froze the run, which is the halt cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the halt cue is heard on the fault",
    );

    // `constellation` — a set consuming its product.
    await openBareRun(h, { challenge: BARE, paused: true });
    await placeSet(h, PRODUCT, ORIGIN, 0);
    await spawnMote(h, ORIGIN, "sol");
    await untilQuiet(h);
    opened = await h.sounds();
    await resumeRun(h);
    for (let frame = 0; frame < 2 * FRAMES_PER_CYCLE; frame += 1) {
      await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
      if ((tallyOf(await h.snapshot(), PRODUCT) ?? 0) > 0) break;
    }
    await h.advance(CUE_FRAMES);
    assertEqual(
      tallyOf(await h.snapshot(), PRODUCT),
      1,
      "the set consumed its constellation, which is the constellation cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the constellation cue is heard on the consumption",
    );

    // `complete` — every target reached at a boundary.
    await openBareRun(h, {
      challenge: ONE_DELIVERY,
      machine: solution([setPart(PRODUCT, ORIGIN.q, ORIGIN.r, 0)]),
      paused: true,
    });
    await h.debug.setTally(PRODUCT, TARGET);
    await allowCompletion(h);
    await untilQuiet(h);
    opened = await h.sounds();
    await resumeRun(h);
    for (let frame = 0; frame < 2 * FRAMES_PER_CYCLE; frame += 1) {
      await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
      if ((await h.snapshot()).sim?.status !== "running") break;
    }
    await h.advance(CUE_FRAMES);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "complete",
      "the boundary at which every tally has reached the target completed the run, which is the complete cue's event",
    );
    assertGreaterThan(
      (await h.sounds()) - opened,
      0,
      "the complete cue is heard on the completion",
    );
  });

  // And what each of them plays is that cue's own produced file: the files this
  // build asked for name all six, one per cue, at six different paths.
  const asked = await h.assetRequests();
  const reached: string[] = [];
  for (const [index, cue] of ONE_SHOT_CUES.entries()) {
    const match = asked.find((path) => requestFor(cue).test(path));
    assertNotNull(
      match ?? null,
      `a request for the ${cue} cue's produced file, ${CUE_FILES[index]}, among ${JSON.stringify(asked)}`,
    );
    if (match !== undefined) reached.push(match);
  }
  assertLength(
    [...new Set(reached)],
    ONE_SHOT_CUES.length,
    "the different files the six cues reached for, which CUE_PATHS names one apiece",
  );
});
