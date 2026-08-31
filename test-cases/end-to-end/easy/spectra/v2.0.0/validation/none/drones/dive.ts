// Spectra — drones/dive: what one posed dive put on the field. LOCAL TO THIS GROUP.
//
// Three of this group's points read a whole dive rather than one instant: how
// many enemy bullets a Shard's dive leaves, which two a Prism's leaves, and that
// a shimmering Flux's leaves none. `specs/swarm.md` states the shot count "over
// the dive", and an enemy bullet does not survive the dive — it falls at
// `ENEMY_BULLET_SPEED` and leaves the field about a second after it is fired — so
// a count taken at the end of the dive would miss a shot taken at its start. The
// dive has to be WATCHED.
//
// This lives here rather than in `harness.ts` because nothing outside this group
// wants it: the swarm group grades where a dive GOES, and reads positions.
//
// It holds no threshold. How far the sweep may run and what the count must be are
// the caller's, since each is that point's own reading of the specification.

import {
  droneById,
  enemyBullets,
  type BulletView,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** What one dive did, gathered frame by frame while it flew. */
export interface DiveWatch {
  /**
   * Every enemy bullet the dive put on the field, first sighting first.
   *
   * By id, so a bullet counted once is not counted again on the next frame, and a
   * bullet that has already fallen off the field is still counted. `specs/swarm.md`
   * fixes an enemy bullet's band for its life, so the entry each holds is the one
   * it was born with.
   */
  shots: BulletView[];
  /** The largest `y` the drone's centre reached: how deep the dive got. */
  deepest: number;
  /** Whether the drone left phase `diving` inside the frames allowed. */
  ended: boolean;
  /** Frames the sweep ran. */
  frames: number;
  /** The snapshot the sweep stopped on. */
  snapshot: SpectraSnapshot;
}

/**
 * Run the drone's dive to its end, sampling every frame, and hand back what it
 * fired and how deep it went.
 *
 * The sweep stops when the drone leaves phase `diving` — which is where a dive
 * ends, by `specs/swarm.md` — or when `maxFrames` is spent, whichever is first.
 * Only a diving drone fires, so nothing is missed by stopping there.
 *
 * The sampling rides {@link Harness.until}'s predicate, which is called on every
 * frame the sweep advances, so the whole watch costs one crossing into the page
 * per frame rather than two.
 */
export async function watchDive(
  h: Harness,
  id: number,
  options: { maxFrames: number },
): Promise<DiveWatch> {
  const seen = new Map<number, BulletView>();
  let deepest = Number.NEGATIVE_INFINITY;

  const swept = await h.until(
    (snapshot) => {
      for (const bullet of enemyBullets(snapshot)) {
        if (!seen.has(bullet.id)) seen.set(bullet.id, bullet);
      }
      const drone = droneById(snapshot, id);
      if (drone === undefined) return true;
      if (drone.y > deepest) deepest = drone.y;
      return drone.phase !== "diving";
    },
    { maxFrames: options.maxFrames, poll: 1 },
  );

  return {
    shots: [...seen.values()],
    deepest,
    ended: swept.hit,
    frames: swept.frames,
    snapshot: swept.snapshot,
  };
}
