// gloamfin/pings — what the Gloamfin checks share. CASE-PROVIDED.
//
// Five of this category's points read the same thing: the wavefronts a Gloamfin
// casts, and when each one left it. `specs/state.md` puts them in `pulses` with
// `source` `"gloamfin"` and a `tint`, and `specs/predators/gloamfin.md` fixes when
// one is cast. Nothing here decides anything — every threshold is stated in the
// check that asserts it — and nothing here reads a figure off the build.
//
// HOW A PING IS SPOTTED. `specs/state.md` gives every wavefront a `source`, a
// `tint` and the tile `ox`, `oy` it came from, and a ping keeps all three for its
// whole flight while its `front` advances. So a watch names each wavefront by that
// triple: a name that stands in one sample and did not in the one before it is a
// cast, and a name that stands in both is the same wavefront still traveling.
//
// WHY NOT SIMPLY "A WAVEFRONT IS THERE NOW AND WAS NOT". Because that is blind
// exactly where `gloamfin/ping-floor` looks. A ping runs `GLOAMFIN_PING_RANGE`
// (`9`) corridor steps at the `SONAR_WAVE_SPEED` (`14`) steps a second
// `specs/sensing.md` fixes, so it stands in `pulses` for two thirds of a second —
// and a build that broke the `GLOAMFIN_PING_MIN_GAP` (`3 s`) floor would cast its
// second ping while the first was still in flight, where a watch reading presence
// alone sees no change and reports the violation as no ping at all.
//
// WHAT THAT COSTS IN PRECISION. A cast is seen at the first sample after it, so a
// sighting's time is at most one poll late and a GAP between two sightings at most
// one poll wrong in either direction. Every check here polls at
// {@link SWEEP_POLL}, which puts that error two orders of magnitude under the
// tolerances the points state.

import type {
  FathomSnapshot,
  Harness,
  PredatorSnapshot,
  PulseSnapshot,
} from "../harness";
import type { Tile } from "../maze";

/**
 * Ticks between two samples of a watch, and so the precision of every time it
 * reports.
 *
 * Two ticks is a sixtieth of a second. The tightest window any check here states
 * is a tenth of a second, thirty times that, and the coarsest thing a watch has to
 * separate — two pings a `GLOAMFIN_PING_MIN_GAP` (`3 s`) floor apart — is a
 * hundred and eighty times it. One tick would halve an error that is already
 * negligible and double what the longest watches cost.
 */
export const SWEEP_POLL = 2;

/** A Gloamfin wavefront, caught at the first sample after it was cast. */
export interface PingSighting {
  /** Simulated seconds at that sample, from the snapshot's own `simTime`. */
  t: number;
  /** `specs/state.md`'s tint for the ping: `"violet"` or `"orange"`. */
  tint: string;
  /** `specs/state.md`'s source: `"gloamfin"` for every ping in this log. */
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
  observe(snap: FathomSnapshot): void;
}

/** The Gloamfin wavefronts standing in a snapshot. */
function gloamfinPulses(snap: FathomSnapshot): PulseSnapshot[] {
  return snap.pulses.filter((pulse) => pulse.source === "gloamfin");
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
    observe(snap) {
      const here = snap.predators[index];
      const tile: Tile | null =
        here === undefined ? null : { tx: here.tx, ty: here.ty };
      const pulses = gloamfinPulses(snap);
      for (const pulse of pulses) {
        if (standing.has(nameOf(pulse))) continue;
        sightings.push({
          t: snap.simTime,
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
 * `advance` rather than `skip`, so the whole watch is what a recorded clip shows
 * when the sweep is wrapped in one; a check that wants a stretch off camera calls
 * this outside its capture.
 *
 * ONE CROSSING, NOT ONE PER SAMPLE. A watch here runs its whole length whatever
 * it sees — nothing about a cadence is decided early — so the loop belongs on the
 * page's side of the line rather than the suite's, which is what
 * {@link Harness.scan} is. The ticks are the same ticks stepped the same way, one
 * `advance(poll)` per sample; what is dropped is the round trip between them, and
 * on a loaded host a round trip costs more than the tick it carries.
 */
export async function sweep(
  h: Harness,
  ticks: number,
  visit: (snap: FathomSnapshot) => void,
  poll: number = SWEEP_POLL,
): Promise<void> {
  for (const reading of await h.scan(ticks, poll)) visit(reading.snapshot);
}

/** The Gloamfin's own entry in a snapshot, by the index the scenario spawned it at. */
export function gloamfinOf(
  snap: FathomSnapshot,
  index: number,
): PredatorSnapshot {
  const predator = snap.predators[index];
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
 * SUMMED PER AXIS RATHER THAN AS A STRAIGHT LINE. `specs/predators.md` has a
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
