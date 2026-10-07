// Spectra — stages/flyover: what one stage's wave did while it flew. LOCAL TO
// THIS GROUP.
//
// Four of this group's points read a whole challenge flyover rather than one
// instant: how many groups it sends and how big they are, whether a group is one
// band, whether consecutive groups alternate, and whether an undestroyed group
// leaves the field. A fifth watches the same stage for enemy fire. None of that
// can be read off a single snapshot — a group is a moment in time, and a drone
// that has already swept off the field is no longer on the roster to be counted.
// So the stage has to be WATCHED, frame by frame, and this is the watch.
//
// This lives here rather than in `harness.ts` because nothing outside this group
// wants it: the swarm group grades a standard wave's entrance and reads
// positions and speeds, not group membership.
//
// IT HOLDS NO THRESHOLD. How far the sweep may run, how often it samples, how
// large a movement counts as a release, and how far apart two releases must be to
// be different groups are all the caller's, since each is that point's own
// reading of the specification.
//
// WHAT "ARRIVING" MEANS HERE, AND WHY IT IS THE RELEASE RATHER THAN THE FIELD.
// `specs/stages.md` says a challenge stage's groups are "released on the same
// schedule a wave's entry groups run on", and `specs/swarm.md` states that
// schedule in terms a watcher can see: "A drone's group is released when that
// clock reaches `ENTER_GROUP_GAP` (`0.6`) seconds times the group's index" and "A
// drone that has not been released holds its starting point." So the observable
// the specification itself defines a group by is the moment a drone STARTS
// MOVING, and a group is the set of drones that start together.
//
// The two other readings both fail, and one of them fails on a conformant build:
//
//   - FIRST SIGHTING ON THE ROSTER is wrong for a build that builds its whole
//     flyover as the wave opens, which `specs/swarm.md` requires of a standard
//     wave and permits of a challenge one: all forty are on the roster from the
//     first frame and read as one group.
//   - FIRST INSIDE THE PLAY FIELD is wrong in the opposite direction. A challenge
//     group sweeps in from off the left or right edge strung out along its path,
//     so its members cross the edge over a second or more — longer than the
//     `ENTER_GROUP_GAP` between two releases — and the next group's leaders cross
//     while the previous group's stragglers are still crossing. Measured against
//     this case's own reference, whose flyover is exactly on the schedule, the
//     field reading interleaves the bands (`c c c c c m c m c m …`) where the
//     release reading recovers five clean groups of eight, sixty frames apart.
//     Grading a band rule on that reading would fail a conformant build.
//
// A drone that is not on the roster at the first sample and appears later counts
// as released at its first sighting: a build that spawns each group as it is
// released never holds a drone still, and holding it to a movement it cannot make
// would grade its spawning strategy rather than its schedule.

import {
  enemyBullets,
  type Band,
  type BulletSnapshot,
  type DronePhase,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** What one drone of the watched wave did while the sweep ran. */
export interface DroneTrack {
  id: number;
  /**
   * The frame of the sweep at which the drone was released: the first sample at
   * which it had moved from where it stood, or its first sighting for a drone
   * that was not on the roster when the sweep began. `null` for a drone that
   * never moved.
   */
  releasedAt: number | null;
  /** The band it read as at its release, or at its first sighting before one. */
  band: Band;
  /** Every phase it was ever seen in, in the order it was first seen in each. */
  phases: DronePhase[];
  /** The frame it was first missing from the roster, or `null` if it never was. */
  leftAt: number | null;
}

/** What the sweep saw. */
export interface FlyoverWatch {
  /** The snapshot the sweep started from: the wave as the stage opened it. */
  opened: SpectraSnapshot;
  /** One track per drone ever seen, in the order each was first seen. */
  tracks: DroneTrack[];
  /** Every enemy bullet ever on the field, by id, first sighting first. */
  fire: BulletSnapshot[];
  /** The frame the screen first left `inWave`, or `null` if it never did. */
  endedAt: number | null;
  /** Frames the sweep advanced. */
  frames: number;
  /** The snapshot the sweep stopped on. */
  snapshot: SpectraSnapshot;
}

/** How the sweep is run. Every figure is the caller's. */
export interface FlyoverOptions {
  /** Frames the sweep may run before it gives up. */
  maxFrames: number;
  /** Frames between two samples. */
  poll: number;
  /** How far a drone must have moved since the last sample to count as released. */
  movedEpsilon: number;
  /** Stop early once this holds of the watch so far. */
  stopWhen?: (watch: FlyoverWatch) => boolean;
}

/**
 * Sweep the live wave, sampling every `poll` frames, and hand back what it did.
 *
 * The sweep stops when `stopWhen` holds, when the screen leaves `inWave`, or when
 * `maxFrames` is spent, whichever is first. The sampling rides
 * {@link Harness.until}'s predicate, which is called once per sample, so the
 * whole watch costs one reading of the snapshot per sample rather than two.
 */
export async function watchFlyover(
  h: Harness,
  options: FlyoverOptions,
): Promise<FlyoverWatch> {
  const opened = h.snapshot();
  const tracks = new Map<number, DroneTrack>();
  const standing = new Map<number, { x: number; y: number }>();
  const fire = new Map<number, BulletSnapshot>();
  let endedAt: number | null = null;
  let frame = -options.poll;

  const watch = (): FlyoverWatch => ({
    opened,
    tracks: [...tracks.values()],
    fire: [...fire.values()],
    endedAt,
    frames: Math.max(0, frame),
    snapshot: opened,
  });

  const swept = await h.until(
    (snapshot) => {
      frame += options.poll;

      for (const bullet of enemyBullets(snapshot)) {
        if (!fire.has(bullet.id)) fire.set(bullet.id, bullet);
      }

      const present = new Set<number>();
      for (const drone of snapshot.drones) {
        present.add(drone.id);
        const track = tracks.get(drone.id);
        if (track === undefined) {
          tracks.set(drone.id, {
            id: drone.id,
            // A drone that was not there at the first sample was spawned into
            // play, so its first sighting IS its release.
            releasedAt: frame === 0 ? null : frame,
            band: drone.effectiveBand,
            phases: [drone.phase],
            leftAt: null,
          });
          standing.set(drone.id, { x: drone.x, y: drone.y });
          continue;
        }
        if (!track.phases.includes(drone.phase)) track.phases.push(drone.phase);
        const was = standing.get(drone.id);
        if (
          track.releasedAt === null &&
          was !== undefined &&
          Math.hypot(drone.x - was.x, drone.y - was.y) > options.movedEpsilon
        ) {
          track.releasedAt = frame;
          track.band = drone.effectiveBand;
        }
        standing.set(drone.id, { x: drone.x, y: drone.y });
      }

      for (const track of tracks.values()) {
        if (track.leftAt === null && !present.has(track.id)) {
          track.leftAt = frame;
        }
      }

      if (endedAt === null && snapshot.screen !== "inWave") endedAt = frame;
      if (endedAt !== null) return true;
      return options.stopWhen?.(watch()) ?? false;
    },
    { maxFrames: options.maxFrames, poll: options.poll },
  );

  return { ...watch(), frames: swept.frames, snapshot: swept.snapshot };
}

/** One release group: the drones that were let go together. */
export interface ReleaseGroup {
  /** The frame of the sweep the group was released on: its first member's. */
  at: number;
  /** Every member's band, in release order. */
  bands: Band[];
  /** Every member's id, in release order. */
  ids: number[];
}

/**
 * The groups the watched drones were released in: runs of releases no more than
 * `gapFrames` apart.
 *
 * Pure arithmetic over what {@link watchFlyover} recorded. A drone that never
 * moved is not in any group — it was never released, which is a fault the caller
 * decides rather than one this hides.
 */
export function releaseGroups(
  tracks: readonly DroneTrack[],
  gapFrames: number,
): ReleaseGroup[] {
  const released = tracks
    .filter(
      (track): track is DroneTrack & { releasedAt: number } =>
        track.releasedAt !== null,
    )
    .sort((a, b) => a.releasedAt - b.releasedAt);

  const groups: ReleaseGroup[] = [];
  let previous: number | null = null;
  for (const track of released) {
    const last = groups[groups.length - 1];
    if (
      last === undefined ||
      previous === null ||
      track.releasedAt - previous > gapFrames
    ) {
      groups.push({
        at: track.releasedAt,
        bands: [track.band],
        ids: [track.id],
      });
    } else {
      last.bands.push(track.band);
      last.ids.push(track.id);
    }
    previous = track.releasedAt;
  }
  return groups;
}
