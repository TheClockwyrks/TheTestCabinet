// ball/corner-graze — a shot near the END of a face banks off that ONE face.
//
// The sibling `bounce-*` checks strike each vertical face at its midpoint,
// travelling dead level. That proves the face reflects, but it is the easiest
// place on the obstacle to get right: the ball is most of the obstacle's height
// from either end, so which face was hit is never in doubt, and with no vertical
// velocity there is nothing for a second, spurious reflection to reverse.
//
// The interesting case is the other end of the same face. Within about a ball
// radius of a corner, deciding WHICH face the ball struck is the whole problem,
// and a build that resolves it on the wrong axis leaves the ball still
// overlapping — so the next step reflects it again, on the other axis. Two
// single-axis reflections on consecutive steps negate the velocity, and the ball
// returns down the path it arrived on instead of banking off the face. Only the
// component normal to the struck face may reverse, so `vy` KEEPING ITS SIGN
// through the contact is the property under test.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BALL_R,
  OBSTACLES,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  SERVE_SPEED,
} from "../../src/constants";
import {
  clearPaddles,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far in from the end of the face each shot lands. The corner zone is one
 * ball radius deep, so this is inside it — while still far enough onto the
 * vertical face that the contact point is unambiguously ON that face, which is
 * what makes "reverse vx, keep vy" the answer rather than a judgement call.
 */
const INSET = 4;
/**
 * A shallow approach: the commonest rally trajectory, and the one that spends the
 * most steps inside the corner zone. A steep shot crosses the zone in a step or
 * two and can miss a wrong-axis resolution entirely.
 */
const ANGLE_DEG = 20;
/** How far short of the face each shot starts, in px of horizontal run-up. */
const RUN_UP = 160;
/** The sweep cap for one graze, in frames: the run-up plus room for the contact. */
const GRAZE_MAX = 120;
/**
 * Held after the horizontal reversal before the ball is read.
 *
 * This settle is the point of the check, not padding. A build that resolves the
 * corner on the wrong axis first reflects vertically and only reverses `vx` on
 * the FOLLOWING step; stopping the instant `vx` turned would read the velocity
 * mid-contact, between the two reflections, and see a correct-looking bank.
 * Reading a few frames later sees the contact as the player does — whole.
 */
const SETTLE = 6;

interface Graze {
  label: string;
  faceX: number;
  endY: number;
  fromLeft: boolean;
  upward: boolean;
}

/**
 * The three grazes. Each pairs a vertical face with the end it is grazed near,
 * and travels in the vertical direction that carries the ball on PAST that end —
 * the case a build gets wrong when it picks the reflection axis by proximity
 * rather than by which face the ball actually overlaps. Between them they cover
 * both obstacles, both vertical faces, and both ends.
 */
const GRAZES: Graze[] = [
  {
    label: "obstacle A, top-left corner",
    faceX: OBSTACLES[0].x0,
    endY: OBSTACLE_CENTERS[0].y - OBSTACLE_HH,
    fromLeft: true,
    upward: true,
  },
  {
    label: "obstacle A, bottom-left corner",
    faceX: OBSTACLES[0].x0,
    endY: OBSTACLE_CENTERS[0].y + OBSTACLE_HH,
    fromLeft: true,
    upward: false,
  },
  {
    label: "obstacle B, top-right corner",
    faceX: OBSTACLES[1].x1,
    endY: OBSTACLE_CENTERS[1].y - OBSTACLE_HH,
    fromLeft: false,
    upward: true,
  },
];

/**
 * The full shot for a graze: where it starts, how fast, and where it lands. The
 * arrival point is `INSET` px along the face from its end (inward, away from the
 * corner), and the start is that point projected back up the velocity by `RUN_UP`
 * px horizontally.
 */
function shotFor(graze: Graze): {
  x: number;
  y: number;
  vx: number;
  vy: number;
} {
  const theta = (ANGLE_DEG * Math.PI) / 180;
  const vx = (graze.fromLeft ? 1 : -1) * SERVE_SPEED * Math.cos(theta);
  const vy = (graze.upward ? -1 : 1) * SERVE_SPEED * Math.sin(theta);
  // Inward along the face: down from a top end, up from a bottom end.
  const yHit = graze.endY + (graze.upward ? INSET : -INSET);
  const back = graze.fromLeft ? RUN_UP : -RUN_UP;
  return { x: graze.faceX - back, y: yHit - (vy / vx) * back, vx, vy };
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("reverses only the component normal to the face it grazed", async () => {
  await startPlaying(harness);
  // The corner zone is one ball radius deep, which is what makes the inset above
  // land inside it; stated here so a change to either is read against the other.
  expect(INSET).toBeLessThan(BALL_R);

  for (const graze of GRAZES) {
    const shot = shotFor(graze);
    clearPaddles(harness);
    harness.debug.setBall(0, { ...shot, spin: 0 });

    const banked = await harness.until(
      (s) => Math.sign(s.ball.vx) !== Math.sign(shot.vx),
      { maxFrames: GRAZE_MAX, poll: 1 },
    );
    await harness.advance(SETTLE);
    const out = harness.snapshot().ball;

    // The bank itself. Without this the vertical assertion would pass vacuously
    // on a build that never reflected the ball at all.
    expect(banked.hit, `${graze.label}: banks off the face`).toBe(true);
    expect(Math.sign(out.vx), `${graze.label}: horizontal reversed`).toBe(
      -Math.sign(shot.vx),
    );

    // The property under test: the ball leaves still travelling the way it came
    // vertically. Both components reversed means it went back down its own path.
    expect(
      Math.sign(out.vy),
      `${graze.label}: keeps travelling ${graze.upward ? "up" : "down"}`,
    ).toBe(Math.sign(shot.vy));

    // And it came off the face rather than through it.
    if (graze.fromLeft) {
      expect(out.x, `${graze.label}: stays left of the face`).toBeLessThan(
        graze.faceX,
      );
    } else {
      expect(out.x, `${graze.label}: stays right of the face`).toBeGreaterThan(
        graze.faceX,
      );
    }
  }
});
