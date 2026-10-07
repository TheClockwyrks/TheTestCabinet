// Deepcore — reading that an effect PLAYED, and where. CASE-PROVIDED.
//
// `specs/assets.md` requires each of the twelve effects authored with
// `particle-2d` and "played live, so it varies shot to shot", and spawned "at the
// event's position: the debris at the bit, the exhaust under the jetpack, the
// sparkle at the pickup, the blast at the pocket, the launch exhaust under the
// rocket". What it deliberately does not fix is HOW a build gets a produced system
// onto the canvas — the runtime's own `/canvas` binding draws each particle as a
// disc, and a build is equally free to play a burst onto a small offscreen field
// and composite that over the mine in one operation, which is what the binding's
// own field/footprint design invites.
//
// So what these points read is neither the discs nor the composite: it is that the
// frame issues MORE DRAWING near the event's position while the effect plays than
// the same scene issues without it. Both ways of getting a system on screen add
// operations there, and a build that draws nothing — the "flat opacity flash or a
// hand-coded loop" the contract refuses, or nothing at all — adds none.
//
// THE COMPARISON IS ALWAYS AGAINST THE SAME SCENE. A count of operations near a
// point is mostly the tiles under it, so a bare number says nothing; what says
// something is the same count taken over the same posed world with the event not
// happening. Every point here takes that control itself.

//
// THE COUNTING HAPPENS IN THE PAGE. A frame of a full-stack build is a couple of
// thousand operations, and handing the whole list across to the suite costs far
// more than the frame itself did — on the reference, some 70 ms a frame against
// 8 ms to drive one, and several times that on a loaded host. A watch here is
// hundreds of frames long, so read that way the two longest points in this file
// ran into the project's two-minute test timeout under load, and a timeout is
// reported as the point FAILING: a build that drew every effect it was asked for
// lost the point to the host it was checked on. So the frame is driven exactly as
// before and the recorder's list of what it drew is read where it already is,
// inside the page, and only the counts cross. What is counted is unchanged: every
// operation that names a position, placed through the transform in force when it
// was issued, exactly as `drawn.ts` places a recorded frame's pictures.

import { RECORDER_GLOBAL, type RecordedOp, type Harness } from "../harness";

/**
 * Drive one frame and report how much of it was drawn within `radius` of each of
 * `points`, in logical stage units.
 *
 * The frame is the same driven, recorded frame `h.frameCalls()` reads — the
 * recorder brackets the build's own step — and the operations are the same list
 * it would hand back; they are walked in the page rather than carried out of it.
 * The transform is followed through `save`/`restore`, `translate`, `scale`,
 * `rotate`, `transform`, `setTransform` and `resetTransform`, and an operation
 * counts once per position it names: the corner of a `rect` or `fillRect`, the
 * centre of an `arc` or `ellipse`, each point of a path segment, and the centre
 * of a `drawImage`'s destination — so a sprite counts where it lands and a
 * particle disc where it is drawn.
 */
export async function drawnNear(
  h: Harness,
  points: readonly { x: number; y: number }[],
  radius: number,
): Promise<number[]> {
  await h.advance(1);
  return h.page.evaluate(
    ([rec, targets, within]) => {
      type Matrix = [number, number, number, number, number, number];
      const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
      const multiply = (m: Matrix, n: Matrix): Matrix => [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
      ];
      const numbers = (
        args: readonly unknown[],
        count: number,
      ): number[] | null => {
        const taken = args.slice(0, count);
        return taken.length === count &&
          taken.every((v) => typeof v === "number")
          ? (taken as number[])
          : null;
      };
      /** The destination of a `drawImage`, whichever of its three shapes it took. */
      const destination = (
        args: readonly unknown[],
      ): { x: number; y: number; w: number; h: number } | null => {
        const rest = args.slice(1);
        const nine = numbers(rest, 8);
        if (nine !== null && rest.length >= 8) {
          return { x: nine[4], y: nine[5], w: nine[6], h: nine[7] };
        }
        const five = numbers(rest, 4);
        if (five !== null && rest.length >= 4) {
          return { x: five[0], y: five[1], w: five[2], h: five[3] };
        }
        const three = numbers(rest, 2);
        return three === null ? null : { x: three[0], y: three[1], w: 0, h: 0 };
      };
      /** The positions a drawing method names, before the transform. */
      const positions = (
        method: string,
        args: readonly unknown[],
      ): { x: number; y: number }[] => {
        switch (method) {
          case "arc":
          case "ellipse":
          case "rect":
          case "roundRect":
          case "fillRect":
          case "strokeRect":
          case "moveTo":
          case "lineTo": {
            const v = numbers(args, 2);
            return v === null ? [] : [{ x: v[0], y: v[1] }];
          }
          case "quadraticCurveTo": {
            const v = numbers(args, 4);
            return v === null
              ? []
              : [
                  { x: v[0], y: v[1] },
                  { x: v[2], y: v[3] },
                ];
          }
          case "bezierCurveTo": {
            const v = numbers(args, 6);
            return v === null
              ? []
              : [
                  { x: v[0], y: v[1] },
                  { x: v[2], y: v[3] },
                  { x: v[4], y: v[5] },
                ];
          }
          case "drawImage": {
            const at = destination(args);
            return at === null
              ? []
              : [{ x: at.x + at.w / 2, y: at.y + at.h / 2 }];
          }
          default:
            return [];
        }
      };

      const recorder = (
        window as unknown as Record<string, { last(): RecordedOp[] }>
      )[rec];
      const ops = recorder === undefined ? [] : recorder.last();
      const counts = targets.map(() => 0);
      const saved: Matrix[] = [];
      let current = IDENTITY;
      for (const op of ops) {
        if (op.op !== "call") continue;
        const { method, args } = op;
        if (method === "save") {
          saved.push(current);
        } else if (method === "restore") {
          current = saved.pop() ?? IDENTITY;
        } else if (method === "translate") {
          const v = numbers(args, 2);
          if (v) current = multiply(current, [1, 0, 0, 1, v[0], v[1]]);
        } else if (method === "scale") {
          const v = numbers(args, 2);
          if (v) current = multiply(current, [v[0], 0, 0, v[1], 0, 0]);
        } else if (method === "rotate") {
          const v = numbers(args, 1);
          if (v) {
            const c = Math.cos(v[0]);
            const s = Math.sin(v[0]);
            current = multiply(current, [c, s, -s, c, 0, 0]);
          }
        } else if (method === "transform") {
          const v = numbers(args, 6);
          if (v) current = multiply(current, v as Matrix);
        } else if (method === "setTransform") {
          const v = numbers(args, 6);
          if (v) current = v as Matrix;
          else if (args.length === 0) current = IDENTITY;
          else if (typeof args[0] === "object" && args[0] !== null) {
            const m = args[0] as Record<string, unknown>;
            const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
            if (parts.every((p) => typeof p === "number"))
              current = parts as Matrix;
          }
        } else if (method === "resetTransform") {
          current = IDENTITY;
        } else {
          for (const point of positions(method, args)) {
            const x = current[0] * point.x + current[2] * point.y + current[4];
            const y = current[1] * point.x + current[3] * point.y + current[5];
            for (const [at, target] of targets.entries()) {
              if (Math.hypot(x - target.x, y - target.y) <= within) {
                counts[at] += 1;
              }
            }
          }
        }
      }
      return counts;
    },
    [RECORDER_GLOBAL, points.map((p) => ({ x: p.x, y: p.y })), radius] as const,
  );
}

/**
 * Drive `frames` frames and report the most drawing any one of them put within
 * `radius` of `at`.
 *
 * `at` is re-read before each frame where the event moves, through the `where`
 * callback, so a plume under a rising miner is measured under the miner rather
 * than where it started.
 */
export async function peakNear(
  h: Harness,
  frames: number,
  radius: number,
  where: () => Promise<{ x: number; y: number }>,
): Promise<number> {
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const at = await where();
    const [near] = await drawnNear(h, [at], radius);
    peak = Math.max(peak, near);
  }
  return peak;
}

/** Drive `frames` frames and report what each put within `radius` of a fixed point. */
export async function seriesNear(
  h: Harness,
  frames: number,
  radius: number,
  at: { x: number; y: number },
): Promise<number[]> {
  const series: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const [near] = await drawnNear(h, [at], radius);
    series.push(near);
  }
  return series;
}

/**
 * Drive `frames` frames and report, for each of several fixed points, the most
 * drawing any one frame put within `radius` of it.
 *
 * One pass for every point, because the seep guarantee is about what happens over
 * the SAME stretch of time at several places at once: reading them one at a time
 * would be reading a different stretch for each.
 */
export async function peaksNear(
  h: Harness,
  frames: number,
  radius: number,
  points: readonly { x: number; y: number }[],
): Promise<number[]> {
  const peaks = points.map(() => 0);
  for (let frame = 0; frame < frames; frame += 1) {
    const near = await drawnNear(h, points, radius);
    for (const [at, count] of near.entries()) {
      peaks[at] = Math.max(peaks[at], count);
    }
  }
  return peaks;
}
