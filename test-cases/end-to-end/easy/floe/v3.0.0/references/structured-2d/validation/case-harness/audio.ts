// Waiting for a build's audio to arrive.
//
// The readings themselves are the harness's — {@link Harness.sounds},
// {@link Harness.loopingSounds} and {@link Harness.loopStarts} reach the injected
// probe, which is the harness's own instrumentation and knows its own global.
// What is here is the pair of WAITS built over them, because they are loops with
// a rule about how they are allowed to step.
//
// WHY A CHECK HAS TO WAIT FOR A BED RATHER THAN READ IT ON ONE FRAME. A build
// that loads its own produced audio files decodes them ASYNCHRONOUSLY, so a bed
// asked for before its file finished decoding cannot start yet, and a conformant
// build asks again on its next frame. That is behaviour a specification leaves
// open, and a check that read the bed on one fixed frame would pass or fail on
// how fast the host decoded rather than on what the build did.
//
// AND WHY THE WAIT CANNOT BE ONE `step(n)`. A drive runs its whole count inside
// ONE synchronous evaluation in the page, so nothing the page awaits can settle
// in the middle of it. These step one frame at a time, and each frame is its own
// crossing — which is what gives the page's own promises a turn.
//
// NEITHER THROWS AND NEITHER ASSERTS. A build with no audio at all spends the
// budget and answers `0`, so the point that is ABOUT the audio reaches its own
// failure with its own message rather than dying inside a helper.
//
// WHICH MAKES ONE THING THE CALLER'S. A build whose audio was never opened is
// silent for a reason that has nothing to do with the build, and reads here
// exactly like one with no audio at all: `0`, patiently, for the whole budget. So
// a check that waits on either of these is a check about sound, and its harness
// is one created with `armAudio` (see {@link HarnessOptions.armAudio}).

import type { Harness } from "./harness";

/** How many frames a wait spends before answering with whatever it has. */
const DEFAULT_MAX_FRAMES = 300;

/** As much of a harness as a wait for audio needs. */
export type AudioWaiter = Pick<
  Harness<unknown, object>,
  "step" | "sounds" | "loopingSounds"
>;

/** Step until the build has a looping bed running, and answer how many it has. */
export async function stepUntilBed(
  h: AudioWaiter,
  maxTicks = DEFAULT_MAX_FRAMES,
): Promise<number> {
  for (let i = 0; i < maxTicks; i += 1) {
    const running = await h.loopingSounds();
    if (running > 0) return running;
    await h.step(1);
  }
  return h.loopingSounds();
}

/**
 * Step until the build has emitted a sound at all, and answer how many it has.
 *
 * The weaker companion to {@link stepUntilBed}, for a build that runs its bed by
 * re-scheduling the buffer end to end rather than by setting `loop` — which a
 * specification that fixes what a bed SOUNDS like, and not how it is made,
 * permits. Same shape: one frame per crossing, no throw, and the count comes back
 * whatever it is.
 */
export async function stepUntilSound(
  h: AudioWaiter,
  maxTicks = DEFAULT_MAX_FRAMES,
): Promise<number> {
  for (let i = 0; i < maxTicks; i += 1) {
    const started = await h.sounds();
    if (started > 0) return started;
    await h.step(1);
  }
  return h.sounds();
}
