// presentation/extract — the one extraction the flash and the burst are read
// over, and the control drive that says what the same hall looks like without
// one.
//
// Nothing here asserts. It poses the hall, releases one core into it, and hands
// back the renders the build drew from the strike on, together with where the
// cores the removal took were standing.
//
// THE SCENARIO, AND WHY IT IS THIS ONE. Two cores of one charge are posed on the
// straight top run (leg 0 of `specs/channel.md`'s polyline, `y = 40`), and the
// injector releases a third along its opening aim of 270 degrees, straight up
// the field from `(420, 330)` (`specs/injector.md` — "Opening aim | 270
// degrees"). The head is posed behind the line the shot crosses, so
// `dot(d - c.position, f)` is positive and the core enters AHEAD of it
// (`specs/injector.md` — "Striking a core"): the inserted core takes the head's
// arc position and the two behind it shift back by the channel spacing, which
// leaves three consecutive cores of one charge in one segment. "A maximal run of
// at least 3 cores is extracted" (`specs/extraction.md`), so the extraction
// resolves on the tick the projectile lands.
//
// The control is the same arrangement with the released core carrying a
// different charge. The run it completes holds one core, so nothing extracts,
// and every other thing on the field — the plate, the injector, the HUD, the
// tick the shot lands on — is what it was.
//
// TWO RENDERS PER TICK, AND WHY THE WHOLE DRIVE IS ONE EVALUATION. The effects
// these renders are read for are presentation, and `specs/assets.md` fixes only
// that a player is "advanced each frame with that frame's delta" and a sheet is
// animated "in the game"; `specs/instrumentation.md` takes the SIMULATION off the
// wall clock under `setAutoStep(false)` and has the loop keep rendering. So a
// build is free to age its burst and its flash on the wall clock, from the
// renders its own loop performs between two steps, or on simulation time, from
// the render each step performs — both are readings the spec admits. A drive that
// stepped from the test process and shipped every frame across the wire would
// read the first kind of build at whatever pace the host let it cross, and a
// burst that is "gone almost as fast as it arrives" would be over before the
// second frame arrived on a loaded machine. So from the strike on, every tick is
// observed twice, inside the page and back to back: the render the step itself
// performed, and the very next render the build's own loop performed on the same
// state. A build aging on simulation time moves between the step renders; one
// aging on the wall clock moves between a step render and the loop render after
// it; and neither reading depends on how long the test process took to ask.

import { SPACING, TICK_MS, type ChargeId, type Point } from "../constants";
import { toDrawCall, type RecordedOp } from "../case-harness/draw-calls";
import {
  drawnPoints,
  fireAt,
  poseHall,
  type DrawCall,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/**
 * The head's arc position, in units from the inlet.
 *
 * Chosen so the head stands BEHIND the point the shot crosses the top run at.
 * The shot leaves `(420, 330)` along 270 degrees and meets `y = 40` at `x = 420`,
 * which is arc `380` on leg 0; the head is posed thirty units short of that and
 * has climbed about ten by the time the projectile arrives, so the projectile's
 * centre is comfortably on the `+x` side of the core it strikes and comfortably
 * inside the 28-unit strike distance.
 */
export const HEAD_S = 350;

/** The charge the two posed cores carry. */
export const RUN_CHARGE: ChargeId = "halide";

/** A charge no posed core carries, for the drive that must not extract. */
export const OTHER_CHARGE: ChargeId = "sulfur";

/**
 * How long the drive waits for the build's loop to render once, in
 * milliseconds, before closing the loop's frame with whatever it holds.
 *
 * The loop is expected to render — `specs/instrumentation.md`: "the loop keeps
 * rendering" — and on any healthy page it does so within a frame. The ceiling is
 * there so a page whose animation frames have stalled leaves a short loop frame
 * behind instead of hanging the drive; the step renders still carry the reading.
 */
const LOOP_RENDER_CEILING_MS = 250;

/** Who performed a render: the step of a tick, or the build's own loop after it. */
export type RenderedBy = "step" | "loop";

/** One render the build performed, and the tick whose state it drew. */
export interface Render {
  /** The tick whose state the render shows, 1-based from the release. */
  tick: number;
  by: RenderedBy;
  /** The operations the render issued. */
  calls: DrawCall[];
}

/** What one drive saw. */
export interface ShotFrames {
  /** The tick the projectile left the hall, 1-based, or -1 if it never did. */
  strike: number;
  /** Whether the strike took cores off the channel. */
  removed: boolean;
  /** Where the cores standing at the strike were, read the tick before it. */
  standing: Point[];
  /**
   * The renders from the strike on, in the order they happened: the strike
   * tick's step render, the loop render after it, the next tick's step render,
   * its loop render, and so on for `keep` ticks past the strike. Empty when
   * the projectile never landed.
   */
  renders: Render[];
  /** The snapshot each tick left, index 0 being the first tick. */
  after: VoluteSnapshot[];
}

/** Pose the two-core run and load `charge` into the injector. */
export async function poseRun(h: Harness, charge: ChargeId): Promise<void> {
  await poseHall(h, {
    level: 1,
    cores: [
      [HEAD_S, RUN_CHARGE, null],
      [HEAD_S - SPACING, RUN_CHARGE, null],
    ],
    loaded: charge,
    queued: OTHER_CHARGE,
  });
}

/** The shape the page hands back, before its operations become draw calls. */
interface RawShot {
  strike: number;
  removed: boolean;
  standing: Point[];
  renders: { tick: number; by: RenderedBy; ops: RecordedOp[] }[];
  after: VoluteSnapshot[];
}

/**
 * Release the loaded core along the opening aim, step until it lands, and keep
 * every render of the `keep` ticks that follow — two per tick.
 *
 * `debug.fire` rather than the fire control, because this drive is not about the
 * cooldown: "Any cooldown outstanding at the call is cleared first, so the call
 * always launches". The drive gives up after `ticks` ticks if nothing lands.
 *
 * The whole of the drive runs inside the page in one evaluation, bracketing each
 * render as a frame of the recorder exactly as the harness's own step does, so
 * a capture armed around it holds every render and nothing crosses the wire
 * until the drive is over. The loop's render is bracketed by opening a frame,
 * waiting for the next animation frame, and closing it there: the build's loop
 * registered its callback before this one did, so it runs first inside that
 * animation frame and its render is the frame's whole content.
 */
export async function driveShot(
  h: Harness,
  ticks: number,
  keep: number,
): Promise<ShotFrames> {
  await fireAt(h, 270);
  // The one part of a drive that rests on the page's own animation frames, so
  // the page is brought forward as the harness's real-time drives do.
  await h.page.bringToFront().catch(() => undefined);
  const raw = (await h.page.evaluate(
    async ([handle, recorderName, tickMs, maxTicks, kept, ceilingMs]) => {
      interface Api {
        step(ticks: number): void;
        snapshot(): VoluteSnapshot;
      }
      interface Recorder {
        begin(): void;
        end(deltaMs: number): void;
        last(): RecordedOp[];
      }
      const globals = window as unknown as Record<string, unknown>;
      const api = globals[handle] as Api;
      const recorder = globals[recorderName] as Recorder;

      const stepped = (): VoluteSnapshot => {
        recorder.begin();
        api.step(1);
        recorder.end(tickMs);
        return api.snapshot();
      };
      const looped = (): Promise<void> =>
        new Promise((resolve) => {
          let closed = false;
          const close = (): void => {
            if (closed) return;
            closed = true;
            recorder.end(0);
            resolve();
          };
          recorder.begin();
          requestAnimationFrame(close);
          setTimeout(close, ceilingMs);
        });

      const result: RawShot = {
        strike: -1,
        removed: false,
        standing: [],
        renders: [],
        after: [],
      };
      let before = api.snapshot();
      for (let tick = 1; tick <= maxTicks; tick += 1) {
        const after = stepped();
        result.after.push(after);
        if (
          result.strike < 0 &&
          before.projectiles.length > 0 &&
          after.projectiles.length === 0
        ) {
          result.strike = tick;
          result.removed = after.train.length < before.train.length;
          result.standing = before.train.map((core) => ({
            x: core.x,
            y: core.y,
          }));
        }
        before = after;
        if (result.strike < 0) continue;
        result.renders.push({ tick, by: "step", ops: recorder.last() });
        await looped();
        result.renders.push({ tick, by: "loop", ops: recorder.last() });
        if (tick - result.strike >= kept) break;
      }
      return result;
    },
    [
      h.config.handle,
      h.config.recorderGlobal,
      TICK_MS,
      ticks,
      keep,
      LOOP_RENDER_CEILING_MS,
    ] as const,
  )) as RawShot;

  return {
    strike: raw.strike,
    removed: raw.removed,
    standing: raw.standing,
    renders: raw.renders.map((render) => ({
      tick: render.tick,
      by: render.by,
      calls: render.ops.map(toDrawCall),
    })),
    after: raw.after,
  };
}

/** Whether `point` is within `radius` of any of `centres`. */
export function nearAny(
  point: Point,
  centres: readonly Point[],
  radius: number,
): boolean {
  return centres.some(
    (centre) => Math.hypot(point.x - centre.x, point.y - centre.y) <= radius,
  );
}

/**
 * The points a frame's GEOMETRY landed on, with every image draw left out.
 *
 * `specs/assets.md` has the produced particle systems played through
 * `@clockwyrks/particle-runtime`'s `./canvas` binding, which composites each
 * live particle as a filled arc on the context it was handed, while every
 * produced sprite reaches the field as a `drawImage`. Dropping the image draws
 * is therefore what separates the effect from the picture it plays over.
 */
export function geometryPoints(calls: readonly DrawCall[]): Point[] {
  const kept = calls.filter(
    (call) =>
      !(
        call.kind === "call" &&
        (call.method === "drawImage" || call.method === "putImageData")
      ),
  );
  return drawnPoints(kept);
}
