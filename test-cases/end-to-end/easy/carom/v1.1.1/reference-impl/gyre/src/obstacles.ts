// Carom (gyre) — the live obstacles.
//
// Each obstacle sways vertically and spins about its own center; its pose is a
// pure function of the obstacle clock `t` (seconds). Because a spinning
// obstacle presents a tilted face, the ball bounces off it at oriented angles
// that have nothing to do with the axis-aligned walls: collision is resolved
// against an oriented rectangle (OBB) in the obstacle's local frame. See
// specs/obstacles.md — this file implements that algorithm verbatim.

import {
  BALL_R,
  OBSTACLE_BASES,
  OBSTACLE_HH,
  OBSTACLE_HW,
  OBSTACLE_SPIN,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "./constants";
import { clamp, type Ball } from "./entities";
import type { StepEvents } from "./types";

export const OBSTACLE_COUNT = OBSTACLE_BASES.length;

export interface ObstaclePose {
  cx: number;
  cy: number;
  theta: number; // radians, taken continuously (cos/sin handle the wrap)
}

// The pose of obstacle `i` at obstacle-clock time `t` (seconds). At t = 0 both
// obstacles are upright at their base centers, so the field opens in the
// familiar layout and the motion grows from there.
export function obstaclePose(i: number, t: number): ObstaclePose {
  const b = OBSTACLE_BASES[i];
  const sway =
    OBSTACLE_SWAY_AMP * Math.sin((2 * Math.PI * t) / OBSTACLE_SWAY_PERIOD);
  return { cx: b.cx, cy: b.cy + b.swaySign * sway, theta: OBSTACLE_SPIN * t };
}

// Resolve the ball against one obstacle at the given pose. Reflects the ball
// off the tilted face (speed and spin preserved — the spin keeps curving the
// ball afterward) and pushes it one radius clear of the contact face.
export function resolveObstaclePose(
  ball: Ball,
  pose: ObstaclePose,
  events: StepEvents,
): void {
  const cos = Math.cos(pose.theta);
  const sin = Math.sin(pose.theta);

  // 1. Ball center into the obstacle's local frame (un-rotate by -theta about
  //    the center). In this frame the obstacle is axis-aligned, spanning
  //    [-hw, hw] x [-hh, hh].
  const dx = ball.x - pose.cx;
  const dy = ball.y - pose.cy;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;

  // 2. Closest point on the local rectangle, and the overlap test.
  const qx = clamp(lx, -OBSTACLE_HW, OBSTACLE_HW);
  const qy = clamp(ly, -OBSTACLE_HH, OBSTACLE_HH);
  const ex = lx - qx;
  const ey = ly - qy;
  const d2 = ex * ex + ey * ey;

  // 3. Local contact normal, and the resolved local position (ball center
  //    placed one radius off the contact face).
  let nlx: number;
  let nly: number;
  let rlx: number;
  let rly: number;
  if (d2 > 1e-9) {
    // Ball center outside the rectangle: normal points from the closest face
    // or corner toward the ball. No overlap if it is farther than one radius.
    if (d2 >= BALL_R * BALL_R) return;
    const d = Math.sqrt(d2);
    nlx = ex / d;
    nly = ey / d;
    rlx = qx + nlx * BALL_R;
    rly = qy + nly * BALL_R;
  } else {
    // Ball center inside the rectangle: eject along the axis of least
    // penetration.
    const penX = OBSTACLE_HW - Math.abs(lx);
    const penY = OBSTACLE_HH - Math.abs(ly);
    if (penX < penY) {
      nlx = lx >= 0 ? 1 : -1;
      nly = 0;
      rlx = nlx * (OBSTACLE_HW + BALL_R);
      rly = ly;
    } else {
      nlx = 0;
      nly = ly >= 0 ? 1 : -1;
      rlx = lx;
      rly = nly * (OBSTACLE_HH + BALL_R);
    }
  }

  // 4. Local normal and resolved position back to world (rotate by +theta).
  const nx = nlx * cos - nly * sin;
  const ny = nlx * sin + nly * cos;

  // 5. Reflect if the ball is moving into the surface; preserve speed and spin.
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= 2 * vn * nx;
    ball.vy -= 2 * vn * ny;
  }
  ball.x = pose.cx + (rlx * cos - rly * sin);
  ball.y = pose.cy + (rlx * sin + rly * cos);

  events.obstacle = true;
}
