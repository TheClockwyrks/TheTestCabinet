// gloamfin/pings — what the Gloamfin checks share. CASE-PROVIDED.
//
// Five of this category's points read the same thing: the wavefronts a Gloamfin
// casts, and when each one left it. specs/state.md puts them in `pulses` with
// `source` "gloamfin" and a `tint`, and specs/predators/gloamfin.md fixes when one
// is cast. Nothing here decides anything — every threshold is stated in the check
// that asserts it — and nothing here reads a figure off the build.
//
// HOW A PING IS SPOTTED. specs/state.md gives every wavefront a `source`, a `tint`
// and the tile `ox`, `oy` it came from, and a ping keeps all three for its whole
// flight while its `front` advances. So a watch names each wavefront by that
// triple: a name that stands in one sample and did not in the one before it is a
// cast, and a name that stands in both is the same wavefront still traveling.
//
// WHY NOT SIMPLY "A WAVEFRONT IS THERE NOW AND WAS NOT". Because that is blind
// exactly where gloamfin/ping-floor looks. A ping runs `GLOAMFIN_PING_RANGE` (9)
// corridor steps at the `SONAR_WAVE_SPEED` (14) steps a second specs/sensing.md
// fixes, so it stands in `pulses` for two thirds of a second — and a build that
// broke the `GLOAMFIN_PING_MIN_GAP` (3 s) floor would cast its second ping while
// the first was still in flight, where a watch reading presence alone sees no
// change and reports the violation as no ping at all.
//
// WHAT THAT COSTS IN PRECISION. A cast is seen at the first sample after it, so a
// sighting's time is at most one poll late and a GAP between two sightings at most
// one poll wrong in either direction. Every check here polls at {@link SWEEP_POLL},
// which puts that error two orders of magnitude under the tolerances the points
// state.

import type { Harness } from "../harness";
import type { Tile } from "../maze";
import type {
  FathomSnapshot,
  PredatorSnapshot,
  PulseSnapshot,
} from "../surface";

/**
 * Frames between two samples of a watch, and so the precision of every time it
 * reports.
 *
 * Two ticks of the harness's 120 Hz clock is a sixtieth of a second. The tightest
 * window any check here states is a tenth of a second, thirty times that, and the
 * coarsest thing a watch has to separate — two pings a `GLOAMFIN_PING_MIN_GAP`
 * (3 s) floor apart — is a hundred and eighty times it.
 */
export const SWEEP_POLL = 2;

/** A Gloamfin wavefront, caught at the first sample after it was cast. */
export interface PingSighting {
  /** Simulated seconds at that sample, from the snapshot's own `simTime`. */
  t: number;
  /** specs/state.md's tint for the ping: "violet" or "orange". */
  tint: string;
  /** specs/state.md's source: "gloamfin" for every ping in this log. */
  source: string;
  /** The tile the wavefront reports as its origin. */
  origin: Tile;
  /**
   * The tiles the Gloamfin held at this sample and at the one before it.
   *
   * A cast happened somewhere inside that window, so a ping cast "from its own
   * tile" reports one of these two and nothing else: at `SWEEP_POLL` ticks the
   * Gloamfin covers under two logical units at any speed this specification gives
   * it, which can carry it across one tile boundary and no more.
   */
  casterTiles: Tile[];
  /** Whether the caster's own body was being drawn at this sample. */
  casterLit: boolean;
}

/** A running log of the pings one Gloamfin cast, fed a snapshot at a time. */
export interface PingLog {
  readonly sightings: PingSighting[];
  /** Take one sample of the watch. */
  observe(snapshot: FathomSnapshot): void;
}

/** The Gloamfin wavefronts standing in a snapshot. */
function gloamfinPulses(snapshot: FathomSnapshot): PulseSnapshot[] {
  return snapshot.pulses.filter((pulse) => pulse.source === "gloamfin");
}

/** What names one wavefront across the samples of its flight (`specs/state.md`). */
function nameOf(pulse: PulseSnapshot): string {
  return `${pulse.tint}|${pulse.ox}|${pulse.oy}`;
}

/** Open a log over the predator at `index`, which is the Gloamfin under watch. */
export function pingLog(index: number): PingLog {
  const sightings: PingSighting[] = [];
  let standing = new Set<string>();
  let previousTile: Tile | null = null;
  return {
    sightings,
    observe(snapshot) {
      const here = snapshot.predators[index];
      const tile: Tile | null =
        here === undefined ? null : { tx: here.tx, ty: here.ty };
      const pulses = gloamfinPulses(snapshot);
      for (const pulse of pulses) {
        if (standing.has(nameOf(pulse))) continue;
        sightings.push({
          t: snapshot.simTime,
          tint: pulse.tint,
          source: pulse.source,
          origin: { tx: pulse.ox, ty: pulse.oy },
          casterTiles: [previousTile, tile].filter(
            (each): each is Tile => each !== null,
          ),
          casterLit: here?.lit === true,
        });
      }
      standing = new Set(pulses.map(nameOf));
      previousTile = tile;
    },
  };
}

/** The seconds between each sighting and the one before it, in order. */
export function pingGaps(sightings: readonly PingSighting[]): number[] {
  return sightings
    .slice(1)
    .map((sighting, index) => sighting.t - sightings[index].t);
}

/** Whether a ping's origin is one of the tiles its caster held around the cast. */
export function castFromOwnTile(sighting: PingSighting): boolean {
  return sighting.casterTiles.some(
    (tile) => tile.tx === sighting.origin.tx && tile.ty === sighting.origin.ty,
  );
}

/**
 * Run `ticks` real ticks, handing every `SWEEP_POLL`th snapshot to `visit`.
 *
 * A check that wants a stretch off camera calls this outside its capture.
 */
export async function sweep(
  h: Harness,
  ticks: number,
  visit: (snapshot: FathomSnapshot) => void,
  poll: number = SWEEP_POLL,
): Promise<void> {
  for (let run = 0; run < ticks; run += poll) {
    await h.advance(Math.min(poll, ticks - run));
    visit(h.snapshot());
  }
}

/** The Gloamfin's own entry in a snapshot, by the index `requireKind` gave. */
export function gloamfinOf(
  snapshot: FathomSnapshot,
  index: number,
): PredatorSnapshot {
  const predator = snapshot.predators[index];
  if (predator === undefined) {
    throw new Error(
      `gloamfin/pings: the roster no longer holds index ${index}, which the ` +
        `scenario posed the Gloamfin at`,
    );
  }
  return predator;
}

/** The distance between two centers, in logical units. */
export function apart(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The ground a body covered between two samples, in logical units.
 *
 * SUMMED PER AXIS RATHER THAN AS A STRAIGHT LINE. specs/predators.md has a
 * predator "always heading in one of the four cardinal directions or standing
 * still", and lets it change direction at a tile center — which can fall inside a
 * tick, leaving that tick's travel as a leg along one axis and a leg along the
 * other. The straight line between the two ends of such a tick is shorter than the
 * ground covered, and a measurement that summed straight lines would read a
 * conforming patrol as slower than it is by however many corners it happened to
 * turn. Per axis, the two legs add exactly.
 */
export function groundBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

/** Place one predator on a tile, and face it and state it where asked. */
export async function placePredator(
  h: Harness,
  index: number,
  tile: Tile,
  options: {
    dir?: "up" | "down" | "left" | "right";
    state?: "den" | "wander" | "chase";
  } = {},
): Promise<void> {
  await h.debug.setPredatorTile(index, tile.tx, tile.ty);
  if (options.dir !== undefined)
    await h.debug.setPredatorDir(index, options.dir);
  if (options.state !== undefined) {
    await h.debug.setPredatorState(index, options.state);
  }
}

/** Place the forager on a tile at rest, and face it `dir` when one is given. */
export async function placeForager(
  h: Harness,
  tile: Tile,
  dir?: "up" | "down" | "left" | "right",
): Promise<void> {
  await h.debug.setForagerTile(tile.tx, tile.ty);
  if (dir !== undefined) await h.debug.setForagerDir(dir);
}
