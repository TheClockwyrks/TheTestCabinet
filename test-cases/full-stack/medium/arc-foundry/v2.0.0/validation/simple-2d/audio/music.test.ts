// Arc Foundry — audio/music: the music bed plays from the first build phase and
// still sounds past the end of its own file.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.music` is "looped
// under the yard from the first build phase onward", and, below the table, "The
// music cue loops until the game ends." `specs/assets.md` renders it with `music`,
// as "a tense, driving industrial bed, looped under the yard".
//
// HOW IT IS OBSERVED. The engine's cue bus announces a bed's start as `cue:looped`,
// a one-shot play as `cue:played`, and a loop's end as `cue:stopped`, each with the
// cue's name. So what is read is those three events for `music` alone, in order:
// the bed is SOUNDING once one of the first two has arrived and stops sounding when
// a `cue:stopped` does. Both routes are accepted because both keep the bed audible,
// and the specification asks for the sound rather than for the call.
//
// THE SPAN IS THE FILE'S OWN LENGTH, read off `assets/audio/music.wav`. A bed that
// is still sounding after longer than its own file has run is a bed that was
// looped: a one-shot that was started once and never restarted is over by then.
// That is the review item's own wording — "it is still sounding after a span longer
// than its own file's duration" — and taking the span from the build's own file is
// what makes it true of any build rather than of one length of bed.
//
// THE CLOCK IS THE CHECK'S. Every frame of the span is spent waiting rather than
// reading, and `specs/instrumentation.md` guarantees that "an interval of
// simulation time reaches the same state however it was divided into frames and
// whatever frame rate produced it", so the span is covered at `LISTEN_HZ`.
//
// THE RUN IS OPENED THROUGH `startRun`, which `specs/instrumentation.md` says
// "opens it on its first build phase", so what is listened to is exactly the moment
// the requirement names. Nothing else is on the yard, so nothing else can end the
// run and stop the bed.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  openRun,
  type Harness,
} from "../harness";
import { durationSeconds, fileOf, readWave } from "./wav";

/** How long past the file's own end the bed must still be sounding. */
const MARGIN_SECONDS = 1;

/**
 * The longest span the bed is listened to for, in seconds of simulation.
 *
 * Every second of the span is real frames of the game, so an unbounded one would
 * let the length of a build's own file decide how long this check runs. Half a
 * minute is far longer than a looping bed for a browser game, so for any such bed
 * the span outlasts the file and decides the requirement; for one longer still,
 * what is decided is the same statement over half a minute, which is never a wrong
 * verdict and only a weaker one.
 */
const LONGEST_SPAN = 30;

/** The rate the bed is listened to at. */
const LISTEN_HZ = 10;

/** The seconds of the first build phase the bed must start inside. */
const OPENING_SECONDS = 0.5;

/** One event the bus announced about the bed, in the order it arrived. */
interface BedEvent {
  kind: "looped" | "played" | "stopped";
  frame: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: LISTEN_HZ });
});

afterEach(() => {
  h?.dispose();
});

it("starts the bed on the first build phase and keeps it sounding past its file", async () => {
  const bed: BedEvent[] = [];
  const note =
    (kind: BedEvent["kind"]) =>
    ({ cue }: { cue: string }): void => {
      if (cue === CUES.music) bed.push({ kind, frame: h.engine.frame().count });
    };
  h.engine.events.on("cue:looped", note("looped"));
  h.engine.events.on("cue:played", note("played"));
  h.engine.events.on("cue:stopped", note("stopped"));

  // The file's own length, so the span below outlasts whatever the build produced.
  const file = durationSeconds(readWave(fileOf(CUES.music)));
  const span = Math.min(file, LONGEST_SPAN) + MARGIN_SECONDS;

  const run = await captureReplay(h, "music", async () => {
    openRun(h);
    await h.advanceSeconds(OPENING_SECONDS);
    const opening = [...bed];
    await h.advanceSeconds(span);
    return { opening, all: [...bed], frame: h.engine.frame().count };
  });

  assertTrue(
    run.opening.some((event) => event.kind !== "stopped"),
    `the ${CUES.music} cue to start sounding inside the first half second of ` +
      "the first build phase, where specs/ui.md loops it under the yard; the " +
      `bus announced ${run.opening.length === 0 ? "nothing" : run.opening.map((e) => e.kind).join(", ")}`,
  );

  const last = run.all[run.all.length - 1];
  assertEqual(
    last === undefined
      ? "nothing"
      : last.kind === "stopped"
        ? "stopped"
        : "sounding",
    "sounding",
    `the ${CUES.music} cue still to be sounding after ${span.toFixed(1)} ` +
      `seconds of the first build phase, against the ${file.toFixed(1)} seconds ` +
      "its own produced file runs for, so the bed loops rather than ending " +
      "(specs/ui.md)",
  );
});
