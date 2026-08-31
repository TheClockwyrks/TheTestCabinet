// paddle/readings — the shared readings of this suite: the polar figures of one
// snapshot ball, and the deflector's center angle sampled tick by tick under a
// held key.
//
// `specs/field.md` measures every radius "from the stage center to the center
// of the ball or pod concerned", and the rotation items read a direction as a
// sign tick over tick, so both readings are pure arithmetic over the snapshot:
// nothing here touches the game and nothing here decides anything.

import { STAGE_CX, STAGE_CY } from "../constants";
import { type Harness, type KesslerSnapshot } from "../harness";

type SnapshotBall = KesslerSnapshot["balls"][number];

/** A ball's center radius, and its radial velocity, outward positive. */
export function ballRadial(ball: SnapshotBall): { r: number; vr: number } {
  const dx = ball.x - STAGE_CX;
  const dy = ball.y - STAGE_CY;
  const r = Math.hypot(dx, dy);
  const vr = r === 0 ? 0 : (dx * ball.vx + dy * ball.vy) / r;
  return { r, vr };
}

/**
 * Hold `code` across exactly `ticks` driven ticks and read the deflector's
 * center angle after each one, releasing the key afterward. The per-tick
 * spelling of the harness's `hold`, for the checks that read the motion tick
 * over tick rather than only where it ended.
 */
export async function anglesUnderHold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<number[]> {
  const angles: number[] = [];
  h.holdKey(code);
  try {
    for (let tick = 0; tick < ticks; tick++) {
      angles.push((await h.tick(1)).paddle.angleDeg);
    }
  } finally {
    h.releaseKey(code);
  }
  return angles;
}
