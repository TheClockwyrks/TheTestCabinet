// Arc Foundry — hearing the build, for the points about the produced audio.
// CASE-PROVIDED.
//
// WHAT CAN BE HEARD FROM OUTSIDE A BUILD ON THIS ENGINE. The cue bus is the
// ENGINE's: `specs/ui.md` has the game "define exactly the twelve cues in `CUES`
// from `initialize`" and "play them by name from `update`", and the engine
// announces every play as a `cue:played` event, synchronously, from inside the
// call. So a check subscribes and reads what arrived — there is no audio device
// to own, no unlock gesture to fake, and no waiting: a cue is announced whether
// or not anything could be heard, and the event carries the cue's NAME and the
// frame it sounded on. That is what makes each of these points decide the
// requirement the specification actually states, rather than only that some sound
// was emitted: a build that plays its leak blip on every kill fails here.
//
// THE PRODUCED `.wav` FILES DO NOT DECODE IN THIS HOST, because decoding audio
// needs a Web Audio context and a node process has none. That costs nothing here:
// `specs/ui.md` has the twelve cues DEFINED from `initialize`, so the names are
// declared whatever arrives, the engine plays them by name and announces each play,
// and the files themselves are read straight off disk by the two points that are
// about the files (`./wav.ts`).
//
// TWO KINDS OF EVENT, AND BOTH LAND ON A FRAME.
//
//   An event the SIMULATION raises — a shot, a hit, a kill, a leak — happens inside
//   a driven frame, and the cue sounds on that frame.
//
//   An event a CONTROL raises — a rock landing, a fold resolving, the level's
//   candidates hardening — is committed by a debug pose, which is a pure state
//   transition and cannot play anything: nothing outside `update` can reach the
//   engine's bus (`specs/instrumentation.md`, and the engine's own `UpdateApi`).
//   So its cue sounds on the ONE frame that follows the commit, which is "the frame
//   its event happens" for a build on this engine, and those points read exactly
//   that frame.

import { CUES, type ComponentType, type CueName } from "../../src/constants";
import {
  captureReplay,
  emptyYard,
  parkUnit,
  standComponent,
  structureCenter,
  ticks,
  watchCues,
  type Harness,
  type Point,
  type TimedCue,
  type Tier,
} from "../harness";

/**
 * The cue each base type's shot plays, from the cue table of `specs/ui.md`: the
 * bolt for a Capacitor, a Choke or a Rectifier, the spark for an Emitter, the
 * chain for a Coil, the discharge for an Arc-Node or a Discharge Rig. The
 * Regulator never fires and so plays none.
 */
export const FIRE_CUE: Readonly<Record<ComponentType, CueName | null>> = {
  capacitor: CUES.fireBolt,
  choke: CUES.fireBolt,
  rectifier: CUES.fireBolt,
  emitter: CUES.fireSpark,
  coil: CUES.fireChain,
  arcnode: CUES.fireDischarge,
  discharge: CUES.fireDischarge,
  regulator: null,
};

/** Every base type `specs/ui.md` binds to `cue`, in the order it lists them. */
export function typesPlaying(cue: CueName): ComponentType[] {
  return (Object.keys(FIRE_CUE) as ComponentType[]).filter(
    (type) => FIRE_CUE[type] === cue,
  );
}

/** Clear ground, well away from the map's waypoint platforms and its chain. */
export const ANCHOR = { col: 21, row: 17 };
export const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/**
 * Eighty units from the head: inside the Scrap range of every firing base type,
 * the shortest of which is the Emitter's `88` (`specs/components.md`).
 */
export const TARGET: Point = { x: HEAD.x + 80, y: HEAD.y };

/** The run-up held silent before an event, in frames. */
export const RUN_UP = ticks(0.1);

/** The cues that sounded on one frame of the drive, by name. */
export function onFrame(cues: readonly TimedCue[], frame: number): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/** The cues that sounded before one frame of the drive, by name. */
export function beforeFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame < frame);
}

/** Just the names, for a failure that reads as a list of cues. */
export function names(cues: readonly TimedCue[]): string[] {
  return cues.map((cue) => cue.cue);
}

/** What one firing structure's first shot sounded like. */
export interface Shot {
  /** Whether it fired at all inside the window. */
  fired: boolean;
  /** The frame of the drive its projectile appeared on. */
  frame: number;
  /** Every cue announced from the moment it was left alone with no target. */
  cues: TimedCue[];
}

/**
 * Stand one firing structure on an emptied yard, hold it silent with nothing in
 * range, then give it a target and run to its first shot.
 *
 * The silent run-up is the half of the requirement that says "and on no frame
 * before it": a structure with nothing in range holds fire (`specs/components.md`),
 * so a build that blips every frame is caught before the shot is ever taken.
 */
export async function fireOnce(
  h: Harness,
  type: ComponentType,
  tier: Tier,
): Promise<Shot> {
  emptyYard(h);
  standComponent(h, type, tier, ANCHOR.col, ANCHOR.row);
  await h.advance(1);

  const cues = watchCues(h);
  await h.advance(RUN_UP);
  parkUnit(h, "slug", TARGET);
  const fired = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(4),
  });
  return { fired: fired.hit, frame: h.frame(), cues };
}

/**
 * Record a point's declared replay, and never let recording it decide the point.
 *
 * The two points that read the produced files off disk declare a replay of a run
 * as their evidence, and a build whose surface cannot be driven must still pass
 * or fail on the files alone. So the drive below is evidence and nothing more.
 */
export async function evidence(
  h: Harness,
  outputId: string,
  drive: () => Promise<void>,
): Promise<void> {
  await captureReplay(h, outputId, async () => {
    try {
      await drive();
    } catch (error) {
      console.warn(
        `arc foundry: could not drive the replay for \`${outputId}\`: ` +
          String(error),
      );
    }
  });
}
