// Automated validation for the Ball sub-item `corner-graze`: a ball that strikes a
// vertical face close to one END of an obstacle reflects off that ONE face, and does
// not have both velocity components reversed.
//
// The sibling `bounce-a-left`/`bounce-a-right`/`bounce-b-left`/`bounce-b-right` checks
// strike each vertical face at its midpoint, travelling dead level. That proves the
// face reflects, but it is the easiest place on the obstacle to get right: the ball is
// 70 px from either end, so which face was hit is never in doubt, and with no vertical
// velocity there is nothing for a second, spurious reflection to reverse.
//
// The interesting case is the other end of the same face. Within about a ball radius
// of a corner, deciding WHICH face the ball struck is the whole problem, and a build
// that resolves it on the wrong axis leaves the ball still overlapping — so the next
// step reflects it again, on the other axis. Two single-axis reflections on
// consecutive steps negate the velocity, and the ball returns down the path it arrived
// on instead of banking off the face. The spec is explicit that only the component
// normal to the struck face reverses (`specs/playfield.md`), so `vy` keeping its sign
// through the contact is the property under test.
//
// Each shot's start position and velocity are preconditions; the reflection is
// produced by the real collision code and read back from the snapshot.

import {
  clearPaddles,
  neutralizeExtraBalls,
  pinObstaclesUpright,
  startPlaying,
  ball0,
  OBSTACLE_A,
  OBSTACLE_B,
  SERVE_SPEED,
  TICK,
} from "../_helpers.mjs";

// Each obstacle is 140 tall (half-extent 70) about its center y, so its end faces sit
// at `y ± OBSTACLE_HALF_H` (specs/playfield.md).
const OBSTACLE_HALF_H = 70;

// How far in from the end of the face each shot lands. The corner zone is one ball
// radius (11 px) deep, so 4 px in is inside it — while still far enough onto the
// vertical face that the contact point is unambiguously ON that face, which is what
// makes "reverse vx, keep vy" the spec's answer and not a judgement call.
const INSET = 4;

// A shallow approach: the commonest rally trajectory, and the one that spends the most
// steps inside the corner zone. A steep shot crosses the zone in a step or two and can
// miss a wrong-axis resolution entirely.
const ANGLE_DEG = 20;

// The run-up in front of each contact, in px — about a third of a second of flight, so
// the clip shows the ball arriving at the corner rather than opening on the rebound.
const RUN_UP = 160;

// The sweep cap for one graze, in ticks: the run-up (~39 ticks) plus room for the
// contact itself. Every shot lands well inside this, so a miss is a real failure to
// reflect rather than a sweep that ran short.
const GRAZE_MAX = 120;

// Held AFTER each rebound, so the clip shows the ball travelling away from the corner
// rather than the single frame it turned. Sized to keep the ball on the field: no shot
// reaches a goal or a wall before the next one is posed.
const TAIL = 36; // 0.30 s

// A beat with the next ball posed and STILL before it launches. Three grazes filmed
// nose-to-tail read as one ball ricocheting between the obstacles; posing it, letting
// it sit, and only then launching makes each graze legible as its own shot.
const GAP = 24; // 0.20 s

// The three grazes. Each pairs a vertical face with the end it is grazed near, and
// travels in the vertical direction that carries the ball on PAST that end — the case
// a build gets wrong when it picks the reflection axis by proximity rather than by
// which face the ball actually overlaps. Between them they cover both obstacles, both
// vertical faces, and both ends.
const GRAZES = [
  {
    label: "obstacle A, top-left corner",
    faceX: OBSTACLE_A.x0,
    endY: OBSTACLE_A.y - OBSTACLE_HALF_H,
    fromLeft: true,
    upward: true,
  },
  {
    label: "obstacle A, bottom-left corner",
    faceX: OBSTACLE_A.x0,
    endY: OBSTACLE_A.y + OBSTACLE_HALF_H,
    fromLeft: true,
    upward: false,
  },
  {
    label: "obstacle B, top-right corner",
    faceX: OBSTACLE_B.x1,
    endY: OBSTACLE_B.y - OBSTACLE_HALF_H,
    fromLeft: false,
    upward: true,
  },
];

// The full shot for a graze: where it starts, how fast, and where it lands. The arrival
// point is `INSET` px along the face from its end (inward, away from the corner), and
// the start is that point projected back up the velocity by `RUN_UP` px horizontally.
function shotFor(graze) {
  const theta = (ANGLE_DEG * Math.PI) / 180;
  const vx = (graze.fromLeft ? 1 : -1) * SERVE_SPEED * Math.cos(theta);
  const vy = (graze.upward ? -1 : 1) * SERVE_SPEED * Math.sin(theta);
  // Inward along the face: down from a top end, up from a bottom end.
  const yHit = graze.endY + (graze.upward ? INSET : -INSET);
  const back = graze.fromLeft ? RUN_UP : -RUN_UP;
  return { vx, vy, yHit, x: graze.faceX - back, y: yHit - (vy / vx) * back };
}

// ARRANGE half of one graze: park the paddles and any extra balls out of the way, pin
// the obstacles upright so the vertical face sits exactly at its base x (a no-op in
// base/multi and for an already-upright build), and line the ball up short of the
// corner. Control ops only, so it is callable from either phase.
async function arrangeGraze(api, graze) {
  await clearPaddles(api);
  await neutralizeExtraBalls(api);
  await pinObstaclesUpright(api);
  const shot = shotFor(graze);
  await api.call("setBall", 0, {
    x: shot.x,
    y: shot.y,
    vx: shot.vx,
    vy: shot.vy,
    spin: 0,
  });
}

// Pose the next graze's ball at rest where its run-up begins, hold there for a beat,
// then launch it from that same spot — so the clip separates this shot from the one
// before it and the launch itself is visible. Every pose restates the full ball state
// rather than patching one field, so a build is never relied on to merge a partial
// update.
async function poseThenLaunch(api, graze) {
  const shot = shotFor(graze);
  const at = { x: shot.x, y: shot.y, spin: 0 };
  await clearPaddles(api);
  await neutralizeExtraBalls(api);
  await pinObstaclesUpright(api);
  await api.call("setBall", 0, { ...at, vx: 0, vy: 0 });
  await api.advance(GAP);
  await api.call("setBall", 0, { ...at, vx: shot.vx, vy: shot.vy });
}

// ACT half of one graze: run the real collision code until the ball's horizontal
// direction reverses, then hold a few more ticks before reading it.
//
// That short settle is the point of the check, not padding. A build that resolves the
// corner on the wrong axis first reflects vertically and only reverses `vx` on the
// FOLLOWING step; stopping the instant `vx` turns would read the velocity mid-contact,
// between the two reflections, and see a correct-looking bank. Reading a few ticks
// later sees the contact as the player does — whole.
const SETTLE = 6;

async function actGraze(api, graze) {
  const shot = shotFor(graze);
  const banked = await api.until(
    (snap) => Math.sign(ball0(snap).vx) !== Math.sign(shot.vx),
    { max: GRAZE_MAX, poll: TICK },
  );
  await api.advance(SETTLE);
  const out = ball0(await api.snapshot());
  return { shot, hit: banked.hit, out };
}

export default function item() {
  const results = [];

  return {
    id: "ball.corner-graze",

    // A live match with the first graze lined up. The other two are posed inside `act`,
    // after this one has run.
    async arrange(api) {
      await startPlaying(api);
      await arrangeGraze(api, GRAZES[0]);
    },

    // All three grazes, in turn. That sequence IS the clip, and it is exactly the three
    // contacts the assertions read: each gets a run-up, its contact at the corner, and
    // a tail travelling away, with the ball posed still for a beat in between.
    //
    // Each graze after the first is re-posed with control ops alone — deliberately NOT
    // via `startPlaying`, which leads with a `reset` and would take the build off the
    // clock the runtime just handed it (specs/instrumentation.md: reset and step both
    // switch to manual stepping). No shot leaves the field, so nothing scores between
    // them and no reset is needed.
    async act(api) {
      for (const [index, graze] of GRAZES.entries()) {
        if (index > 0) await poseThenLaunch(api, graze);
        results.push({ graze, ...(await actGraze(api, graze)) });
        await api.advance(TAIL);
      }
    },

    async assert(api, check) {
      for (const { graze, shot, hit, out } of results) {
        // The bank itself. Without this the vertical assertion below would pass
        // vacuously on a build that never reflected the ball at all.
        check.expectOk(
          `${graze.label}: the ball banks off the face (its horizontal direction reverses)`,
          hit && Math.sign(out.vx) === -Math.sign(shot.vx),
        );

        // The property under test: only the component normal to the struck face
        // reverses, so the ball leaves still travelling the way it came vertically.
        // Both components reversed means it went back down its own incoming path.
        check.expectOk(
          `${graze.label}: it keeps travelling ${graze.upward ? "up" : "down"} through the bounce (vertical direction unchanged)`,
          Math.sign(out.vy) === Math.sign(shot.vy),
        );

        // And it came off the face rather than through it.
        if (graze.fromLeft) {
          check.expectLt(
            `${graze.label}: the ball stays on the near (left) side of the face (x)`,
            out.x,
            graze.faceX,
          );
        } else {
          check.expectGt(
            `${graze.label}: the ball stays on the near (right) side of the face (x)`,
            out.x,
            graze.faceX,
          );
        }
      }
    },
  };
}
