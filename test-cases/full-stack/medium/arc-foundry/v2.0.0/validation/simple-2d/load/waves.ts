// load — reading back the composition of a wave the game itself composed.
//
// Not a suite: vitest collects `*.test.ts` alone, so nothing here runs on its
// own. Five checks next door decide a composition rule of specs/enemies.md —
// the air cadence, the milestone Dynamos, the opening waves, when Clusters and
// Slugs are allowed, and the growth floor — and every one of them needs the same
// thing: how many units of each type a chosen wave releases, off a wave the game
// composed and launched itself, with nothing else on the yard.
//
// HOW A CHOSEN WAVE IS REACHED. specs/campaign.md gives a level one build phase
// followed by the wave its harvest launches, and specs/instrumentation.md's
// `setWave` sets the counter "so units released from now on scale to wave `n`".
// So a run posed at `w - 1` and then harvested launches wave `w`, composed and
// scaled as wave `w`, without the `w - 1` waves before it having to be played.
//
// THE HARVEST IS A REGULATOR. Committing the harvest is the only way to start a
// wave (specs/campaign.md: "There is no separate send control"), so a structure
// is always left standing when one starts. specs/components.md has exactly one
// type that never fires, and that is the one used here: a Regulator has no
// range, no damage and no targeting, so nothing on the yard can remove a unit
// before it has been counted, and its aura has no firing structure to buff.
//
// HOW THE COMPOSITION IS READ. specs/enemies.md settles a wave's composition when
// the wave begins — "the sequence of releases is fixed at that moment and the wave
// releases exactly that sequence" — and specs/instrumentation.md's
// `waveCount(type)` reports that sequence: the live wave's OWN schedule, the array
// the spawner is working through, counted by type. A unit still to come counts, one
// already walking counts, and one that has died, leaked or been swept away goes on
// counting, so the figure does not move across the wave. A check therefore launches
// the wave it is about and reads it on the frame it launched, spending no frames
// watching units it already knows are coming walk the yard.
//
// WHAT KEEPS THAT READ HONEST is that `waveCount` IS the schedule rather than a
// figure kept beside it, and one check drives the expensive path to prove it:
// `instrumentation/wave-count-matches-the-spawner` launches one wave, reads the six
// counts, plays that wave to its clear with {@link collectWave} below, and asserts
// that what arrived is exactly what was counted, in both directions. The mapping
// from the read to the behaviour is decided ONCE there rather than once per
// composition rule.
//
// HOW A WAVE IS READ TO ITS END, for that one check and for nothing else. Every
// unit released is appended to the snapshot's `units`, so sampling often enough that
// nothing can arrive and leave between two samples reads every one of them. The
// yard is emptied after each sample through `clearUnits`, which "removes every live
// unit ... None of them is killed and none of them leaks, so no bounty is paid and
// no Grid Integrity is lost" — and that is also what ends the reading, because "a
// wave with nothing left to release and nothing left on the yard clears on the next
// advance". A wave therefore ends the moment its schedule is exhausted rather than
// tens of seconds later when its last unit finally grounds out.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { assertEqual, assertTruthy, fail } from "../assert";
import {
  difficultyById,
  LOAD_TYPES,
  loadDef,
  scaledHp,
  type DifficultyId,
  type LoadType,
  type SpawnType,
} from "../constants";
import {
  captureReplay,
  createHarness,
  type FoundrySnapshot,
  type Harness,
  openYard,
  startWave,
  TICK_MS,
} from "../harness";

/** One unit a wave released, as the snapshot first reported it. */
export interface Released {
  id: number;
  type: SpawnType;
}

/** Where the Regulator that commits each level's harvest stands. */
const HARVEST = { col: 10, row: 10 };

/**
 * The frame rate a wave is driven at: `20` Hz, a sixth of this project's default.
 *
 * ONE check spends frames on a wave — `instrumentation/wave-count-matches-the-
 * spawner`, which drives one to its clear — and the composition checks spend a few
 * on the opening of the wave each keeps as its clip. A wave's schedule is tens of
 * seconds of simulation either way, and the specification deliberately fixes no
 * frame size: "an interval of simulation time reaches the same state however it was
 * divided into frames and whatever frame rate produced it"
 * (specs/instrumentation.md). Nothing read across a wave here is a projectile, so
 * the one step size this project has to respect — a shot's travel staying inside
 * its hit radius — does not arise, and a `50` ms frame is an ordinary frame for a
 * slow machine rather than an exotic one. A build that cannot be read at it fails
 * `instrumentation/frame-division-movement`, which is the point that requirement
 * belongs to.
 */
const HZ = 20;

/** Frames between two readings of the yard: half a second. */
const POLL = Math.max(1, Math.round(HZ / 2));

/** Three minutes of simulation: past any wave, and a verdict if a build has none. */
const MAX_FRAMES = 180 * HZ;

/** A harness whose clock runs at the rate a composition is read at. */
export function createWaveHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock((TICK_MS * 120) / HZ) });
}

/**
 * A run posed at the build phase whose harvest launches wave `wave`, on an
 * otherwise empty yard.
 */
export function openWave(
  h: Harness,
  wave: number,
  difficulty: DifficultyId,
): void {
  openYard(h, { difficulty, wave: wave - 1 });
}

/**
 * Commit the harvest, read every unit the wave releases, and hand them back.
 *
 * THE EXPENSIVE PATH, and one check drives it:
 * `instrumentation/wave-count-matches-the-spawner`, which holds what arrived
 * against what {@link composition} counted. Every other composition check reads
 * the schedule and spends none of these frames.
 */
export async function collectWave(
  h: Harness,
  wave: number,
): Promise<Released[]> {
  launchWave(h, wave);
  return readReleased(h, wave);
}

/**
 * Read a LIVE wave to its end, unit by unit, and hand back everything it
 * released.
 *
 * `onSample` is handed the snapshot of each reading, before the yard is swept,
 * for a caller that wants to watch something else across the wave.
 */
export async function readReleased(
  h: Harness,
  wave: number,
  onSample?: (snapshot: FoundrySnapshot) => void | Promise<void>,
): Promise<Released[]> {
  const seen = new Map<number, Released>();
  let frames = 0;
  for (;;) {
    const s = h.snapshot();
    for (const unit of s.units) {
      if (!seen.has(unit.id)) {
        seen.set(unit.id, { id: unit.id, type: unit.type });
      }
    }
    if (onSample) await onSample(s);
    if (!s.waveActive) break;
    if (s.units.length > 0) h.debug.clearUnits();
    if (frames >= MAX_FRAMES) {
      fail(
        `wave ${wave} to release its units and clear (specs/campaign.md); it ` +
          `was still live after ${MAX_FRAMES / HZ} seconds, having released ` +
          `${seen.size}`,
        "a wave that never ends",
      );
    }
    await h.advance(POLL);
    frames += POLL;
  }

  assertTruthy(
    seen.size > 0,
    `wave ${wave} to release at least one unit (specs/enemies.md)`,
  );
  return [...seen.values()];
}

/** How many of one type a wave released. */
export function countOf(
  released: readonly Released[],
  type: SpawnType,
): number {
  return released.filter((unit) => unit.type === type).length;
}

/* ---- The composition a wave was composed with ---------------------------- */

/** The seconds of a wave a check keeps as its replay clip, once its subject is on. */
const CLIP_SECONDS = 4;

/**
 * How long a clip waits for the thing it is a clip OF before recording anyway.
 *
 * A check whose declared evidence is one unit arriving has to wait for that unit, and
 * WHERE inside a wave a build releases it is the build's own choice: specs/enemies.md
 * fixes what a wave carries and leaves the timing of the releases to the build. Thirty
 * seconds is past the span of any wave, so a build that releases the unit at all is
 * filmed with it on screen, and one that never does still leaves the clip its failure
 * is read against rather than hanging the check.
 */
const CLIP_CEILING_SECONDS = 30;

/**
 * How many units of each roster type the live wave's schedule holds.
 *
 * The Overload Dynamo is not a wave's to release (specs/enemies.md keeps it
 * distinct from the Dynamo boss), so the six roster types are the whole of it.
 */
export type Composition = Readonly<Record<LoadType, number>>;

/**
 * Commit the level's harvest, and confirm it launched the wave the run was posed
 * for.
 *
 * The harvest is the only thing that starts a wave (specs/campaign.md: "There is
 * no separate send control"), so the wave a check reads is one the game really
 * composed and really started, at the number the check asserts against.
 */
export function launchWave(h: Harness, wave: number): void {
  startWave(h, "regulator", 1, HARVEST.col, HARVEST.row);
  const launched = h.snapshot();
  assertEqual(
    launched.wave,
    wave,
    "the harvest launches the wave the run was posed for " +
      "(specs/campaign.md)",
  );
  assertTruthy(
    launched.waveActive,
    `wave ${wave} to be running the frame its harvest was committed ` +
      "(specs/campaign.md)",
  );
}

/** The live wave's own schedule, counted by type. */
export function composition(h: Harness): Composition {
  const counts = {} as Record<LoadType, number>;
  for (const type of LOAD_TYPES) counts[type] = h.debug.waveCount(type);
  return counts;
}

/**
 * Open wave `wave`, launch it, and read the composition it will release.
 *
 * The drive of every composition check.
 */
export function composedWave(
  h: Harness,
  wave: number,
  difficulty: DifficultyId,
): Composition {
  openWave(h, wave, difficulty);
  launchWave(h, wave);
  return composition(h);
}

/**
 * The same, with the wave kept as `outputId`'s clip.
 *
 * The evidence a reviewer watches is the wave ARRIVING; what the check decides is
 * read off the schedule on the frame the wave launched, before a frame runs, so
 * the clip sits beside the assertion rather than carrying it.
 *
 * `showing` is what that clip has to have on screen before its {@link CLIP_SECONDS}
 * are filmed — a check whose output is named for one unit's arrival hands the
 * predicate that finds it, so the clip actually holds what the manifest says it does.
 * A check whose evidence is the opening of the wave, or an absence, passes none.
 */
export async function composedWaveOnCamera(
  h: Harness,
  wave: number,
  difficulty: DifficultyId,
  outputId: string,
  showing?: (snapshot: FoundrySnapshot) => boolean,
): Promise<Composition> {
  openWave(h, wave, difficulty);
  return captureReplay(h, outputId, async () => {
    launchWave(h, wave);
    const counts = composition(h);
    if (showing) {
      await h.until(showing, {
        maxFrames: CLIP_CEILING_SECONDS * HZ,
        poll: POLL,
      });
    }
    await h.advance(CLIP_SECONDS * HZ);
    return counts;
  });
}

/** How many units of one type the wave's schedule holds. */
export function countIn(counts: Composition, type: LoadType): number {
  return counts[type];
}

/** The types the wave's schedule holds, in roster order. */
export function typesIn(counts: Composition): LoadType[] {
  return LOAD_TYPES.filter((type) => counts[type] > 0);
}

/**
 * A wave's total health pool: the maximum health of every unit it releases.
 *
 * `Σ count(t) × HP(t, w)`, with `HP` the per-wave scaling of specs/enemies.md over
 * the roster's base health and the difficulty's four constants — every figure from
 * this project's own `constants.ts` and none of them from the build. That the
 * scaling itself is right is `load/health-scales-by-wave`'s requirement rather than
 * this one's.
 */
export function poolOf(
  counts: Composition,
  wave: number,
  difficulty: DifficultyId,
): number {
  const diff = difficultyById(difficulty);
  return LOAD_TYPES.reduce(
    (total, type) =>
      total + counts[type] * scaledHp(loadDef(type).baseHealth, wave, diff),
    0,
  );
}
