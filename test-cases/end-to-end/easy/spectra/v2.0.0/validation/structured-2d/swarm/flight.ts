// Spectra — swarm/flight: what a watched drone did, frame by frame. LOCAL TO
// THIS GROUP.
//
// Most of this group's points read a PATH rather than an instant: where a wave's
// drones were when each of them started moving, how much ground one second of an
// entrance or a dive covered, whether a step between two frames was a jump, how
// deep a dive went before it turned. None of that can be read off a single
// snapshot, so the drive has to be sampled every frame and the samples kept.
//
// It lives here rather than in `harness.ts` because nothing outside this group
// wants it: the drones group watches what a dive FIRES (`drones/dive.ts`), and
// this one watches where a drone GOES.
//
// IT HOLDS NO THRESHOLD. How far a drone must move before it counts as released,
// how big a step counts as a discontinuity, and how long a watch may run are the
// caller's, because each is that point's own reading of the specification. What
// is here is the sampling and the arithmetic over the samples.

import {
  droneById,
  seconds,
  TICK_HZ,
  type Band,
  type DroneKind,
  type DronePhase,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** One reading of one drone, taken at the end of a driven frame. */
export interface Sample {
  /** Seconds of game time since the watch opened. */
  t: number;
  /** The drone's CENTRE at that moment. */
  x: number;
  y: number;
  phase: DronePhase;
}

/** Every reading of one drone over one watch, oldest first. */
export interface Track {
  id: number;
  kind: DroneKind;
  /** The band and slot the drone was first sighted with; neither is posed away. */
  band: Band;
  effectiveBand: Band;
  slotX: number;
  slotY: number;
  samples: Sample[];
}

/** What a watch of the whole field saw. */
export interface Watch {
  tracks: Track[];
  /** Frames the watch drove. */
  frames: number;
  /** The snapshot the watch stopped on. */
  snapshot: SpectraSnapshot;
}

/**
 * Sample every drone on the field, once per frame, for `frames` frames.
 *
 * The sampling rides {@link Harness.until}'s predicate, which is called on the
 * state before the first frame and then on every frame the sweep advances, so a
 * watch costs one reading of the snapshot per frame and the first sample is the
 * field as the watch opened.
 *
 * A drone that appears part-way through is tracked from its first sighting, and
 * one that leaves simply stops having samples, so a caller reads each track's
 * own span rather than assuming the roster held still.
 */
export async function watchDrones(
  h: Harness,
  options: { frames: number },
): Promise<Watch> {
  const tracks = new Map<number, Track>();
  let index = 0;

  const swept = await h.until(
    (snapshot) => {
      const t = seconds(index);
      index += 1;
      for (const drone of snapshot.drones) {
        let track = tracks.get(drone.id);
        if (track === undefined) {
          track = {
            id: drone.id,
            kind: drone.kind,
            band: drone.band,
            effectiveBand: drone.effectiveBand,
            slotX: drone.slotX,
            slotY: drone.slotY,
            samples: [],
          };
          tracks.set(drone.id, track);
        }
        track.samples.push({ t, x: drone.x, y: drone.y, phase: drone.phase });
      }
      return false;
    },
    { maxFrames: options.frames, poll: 1 },
  );

  return {
    tracks: [...tracks.values()],
    frames: swept.frames,
    snapshot: swept.snapshot,
  };
}

/** What a watch of one drone saw. */
export interface Trace {
  samples: Sample[];
  /** Whether `stop` ever held, or the drone left the roster. */
  stopped: boolean;
  /** Whether the drone was still on the field at the last sample. */
  present: boolean;
  snapshot: SpectraSnapshot;
}

/**
 * Sample one drone, once per frame, until `stop` holds or `frames` are spent.
 *
 * `stop` is handed each sample as it is taken, so a caller can end the watch on
 * something it can only see frame by frame — a phase leaving `diving`, a step
 * that jumped, a path that turned. The sample `stop` held on is kept, which is
 * what lets a caller read the pair of samples a discontinuity sits between.
 *
 * A drone that leaves the roster ends the watch too, with `present` false.
 */
export async function traceDrone(
  h: Harness,
  id: number,
  options: {
    frames: number;
    stop?: (sample: Sample, taken: Sample[]) => boolean;
  },
): Promise<Trace> {
  const samples: Sample[] = [];
  let index = 0;
  let present = true;

  const swept = await h.until(
    (snapshot) => {
      const t = seconds(index);
      index += 1;
      const drone = droneById(snapshot, id);
      if (drone === undefined) {
        present = false;
        return true;
      }
      const sample: Sample = { t, x: drone.x, y: drone.y, phase: drone.phase };
      samples.push(sample);
      return options.stop?.(sample, samples) ?? false;
    },
    { maxFrames: options.frames, poll: 1 },
  );

  return { samples, stopped: swept.hit, present, snapshot: swept.snapshot };
}

/** The distance between two samples' centres, in logical units. */
export function step(a: Sample, b: Sample): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Every consecutive step of a trace, in the order they were travelled. */
export function steps(samples: readonly Sample[]): number[] {
  const travelled: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    travelled.push(step(samples[i - 1], samples[i]));
  }
  return travelled;
}

/**
 * The index of the first sample that sits more than `moved` units from where the
 * drone started, or `-1` if it never did.
 *
 * What a caller reads as the moment the drone was RELEASED: an unreleased drone
 * holds its starting point (`specs/swarm.md`), so the first sample that has left
 * it is the first sample after the release. `moved` is the caller's, since how
 * much movement counts as movement follows from the speed the caller's point is
 * about.
 */
export function firstMotion(samples: readonly Sample[], moved: number): number {
  const start = samples[0];
  if (start === undefined) return -1;
  for (let i = 1; i < samples.length; i += 1) {
    if (step(start, samples[i]) > moved) return i;
  }
  return -1;
}

/** The path length a run of samples covered, as the sum of its steps. */
export function pathLength(samples: readonly Sample[]): number {
  return steps(samples).reduce((total, travelled) => total + travelled, 0);
}

/** The deepest `y` a run of samples reached. */
export function deepest(samples: readonly Sample[]): number {
  return samples.reduce(
    (low, sample) => (sample.y > low ? sample.y : low),
    Number.NEGATIVE_INFINITY,
  );
}

/**
 * Ground covered over a run of frames, as units per second of game time.
 *
 * The suite's clock is fixed at `TICK_HZ`, so `frames` frames are
 * `frames / TICK_HZ` seconds and the rate is the quotient. Arithmetic, not a
 * reading: what the answer is compared against is the caller's.
 */
export function speedOverFrames(covered: number, frames: number): number {
  return (Math.abs(covered) * TICK_HZ) / frames;
}
