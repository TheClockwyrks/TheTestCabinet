// Arc Foundry — audio/music: the music bed plays from the first build phase and
// loops rather than ending.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.music` is "looped
// under the yard from the first build phase onward", and, below the table, "The
// music cue loops until the game ends." `specs/assets.md` renders it with `music`,
// as "a tense, driving industrial bed, looped under the yard".
//
// HOW LOOPING IS OBSERVED, AND WHY IT IS NOT TIMED. A bed that outlasts its own
// file is a bed a browser was told to repeat: every way of playing audio in a
// browser carries that instruction on the thing being played — `loop` on a Web
// Audio source node, `loop` on an `<audio>` element — and a source started once
// with it set sounds until it is stopped. So what this reads is the sound the build
// actually started: the probe below wraps the same two doors `audio-init.js`
// watches, before the run is opened, and records whether each sound the build
// started was started as a loop. Waiting out the file instead would mean holding
// the validator for however long a build's bed happens to be, and would decide the
// same thing.
//
// WHAT IS ASSERTED. That the build started at least one sound, and that at least
// one of the sounds it started once the run opened was started as a loop. The run
// is opened through `startRun`, which `specs/instrumentation.md` says "opens it on
// its first build phase" — so what is being listened to is exactly the moment the
// requirement names.
//
// WHAT CANNOT BE SEPARATED. Which sound was the bed. The name of a sound is not
// observable from outside an engineless build, so a build that loops some other cue
// and never plays a bed would pass this; that half is the reviewer's, by ear.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openRun,
  ticks,
  type Harness,
} from "../harness";

/**
 * How many chances the first build phase is given to start the bed, and how much
 * real time each waits.
 *
 * Generous, because opening a browser's audio means fetching and decoding every
 * produced cue file, and this project drives four pages at once — how long that
 * takes is a fact about the machine rather than about the build. The loop returns
 * the instant the build has started anything, so the budget is paid only by a
 * build that starts nothing, which is the miss this point is about.
 */
const ATTEMPTS = 60;
const WAIT_MS = 50;

/** One sound the build started, and whether it was started as a loop. */
interface Started {
  loop: boolean;
}

/**
 * Record every sound the build starts from now on, and whether it loops.
 *
 * Installed over whatever is already wrapping those two doors, and calling
 * through, so the build behaves exactly as it would unobserved.
 */
async function watchLoops(h: Harness): Promise<void> {
  await h.page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown> & {
      __foundryStarted?: Started[];
    };
    const started: Started[] = [];
    scope.__foundryStarted = started;
    const record = (node: unknown): void => {
      started.push({ loop: (node as { loop?: unknown }).loop === true });
    };
    const wrap = (proto: unknown, name: string): void => {
      if (proto === undefined || proto === null) return;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor === undefined || typeof descriptor.value !== "function") {
        return;
      }
      const original = descriptor.value as (...args: unknown[]) => unknown;
      (proto as Record<string, unknown>)[name] = function (
        this: unknown,
        ...args: unknown[]
      ): unknown {
        record(this);
        return original.apply(this, args);
      };
    };
    const w = window as unknown as Record<string, { prototype: unknown }>;
    for (const kind of [
      "AudioScheduledSourceNode",
      "OscillatorNode",
      "AudioBufferSourceNode",
      "ConstantSourceNode",
    ]) {
      wrap(w[kind]?.prototype, "start");
    }
    wrap(w.HTMLMediaElement?.prototype, "play");
  });
}

/** Every sound the build has started since the probe was installed. */
async function startedSounds(h: Harness): Promise<Started[]> {
  return h.page.evaluate(
    () =>
      (window as unknown as { __foundryStarted: Started[] }).__foundryStarted,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a looping sound when the run opens on its first build phase", async () => {
  // The gesture first, because a browser opens no audio context without one and
  // `specs/ui.md` leaves that unlock to the runtime layer the build writes.
  await h.armAudio();
  await watchLoops(h);

  const opened = await captureReplay(h, "music", async () => {
    await openRun(h);
    // A browser opens an audio context asynchronously, so the bed cannot start on
    // the first frame of the build phase however conformant the build is: the
    // wait below is real time for that to land, and the frames are the build
    // phase running. Both are bounded, and the loop stops the moment the build
    // has started anything.
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await h.page.waitForTimeout(WAIT_MS);
      await h.advance(ticks(0.02));
      const started = await startedSounds(h);
      if (started.length > 0) return started;
    }
    return startedSounds(h);
  });

  assertGreaterThan(
    opened.length,
    0,
    "the build to start a sound once the run has opened on its first build " +
      "phase, where specs/ui.md loops the music bed under the yard",
  );
  assertGreaterThan(
    opened.filter((sound) => sound.loop).length,
    0,
    "one of the sounds the build starts on its first build phase to be " +
      "started as a loop, so the bed sounds past the end of its own file " +
      "(specs/ui.md)",
  );
});
