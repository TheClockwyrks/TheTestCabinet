// Automated validation for the Gyre sub-item `oriented-bounce`: the ball bounces off
// the obstacles' tilted faces at oriented angles that track each obstacle's current
// orientation, rather than axis-aligned reflections.
//
// setObstacleClock poses the obstacles at a chosen orientation and holds them there
// (see specs/instrumentation.md). The same purely-horizontal shot is fired at
// obstacle A's center twice: once upright, where a vertical face sends it straight
// back (no vertical deflection); and once tilted ~45deg, where the oriented face
// deflects it well off-axis. The contrast proves the bounce follows the face's tilt.
//
// NOTE: setObstacleClock takes SECONDS. It poses the obstacle clock rather than
// advancing time, so its argument is NOT a tick count — only the shot's own flight
// (which does consume time) is in ticks.

import { ball0 } from "../_helpers.mjs";

// How long each bounce is left on screen after it resolves, so the recorded clip
// shows the outgoing angle rather than cutting at the moment of contact. The two
// together make the old 1500ms clip.
const TAIL = 90; // 90 ticks = 0.75 s

/**
 * Fire a purely-horizontal shot at obstacle A's current center and return the ball's
 * outgoing vertical velocity once it bounces. The bounce is detected when the ball's
 * velocity turns away from its purely-horizontal launch — either the horizontal
 * component drops sharply (an upright face reverses it) or a vertical component
 * appears (a tilted face deflects it off-axis). One predicate covers both cases.
 *
 * ACT-phase only: it consumes time. Polls one tick at a time (the old `stepUntil`
 * default) because the instant of the bounce is what is read.
 */
async function shootHorizontalAtObstacleA(api) {
  const obs = (await api.snapshot()).obstacles[0];
  await api.call("setBall", 0, {
    x: obs.cx - 220,
    y: obs.cy,
    vx: 520,
    vy: 0,
    spin: 0,
  });
  const r = await api.until(
    (s) => ball0(s).vx < 300 || Math.abs(ball0(s).vy) > 80,
    { max: 96 }, // 96 ticks = the old 0.8 s cap
  );
  return { obs, hit: r.hit, outVy: ball0(r.snap).vy };
}

export default function item() {
  // The two shots `act` drove, for `assert` to contrast.
  let upright;
  let tilted;

  return {
    id: "gyre.oriented-bounce",

    // Upright control: obstacle clock at 0 holds obstacle A upright, presenting a
    // vertical face — the horizontal shot returns straight (no vertical deflection).
    // Only this first scenario can be posed here; the tilted one needs a fresh match,
    // which cannot be started until the upright shot has been driven and read.
    async arrange(api) {
      await api.reset();
      await api.call("startMatch", "versus");
      await api.call("serve");
      await api.call("setObstacleClock", 0); // seconds, not ticks
    },

    async act(api) {
      upright = await shootHorizontalAtObstacleA(api);
      // Hold on the straight return so the clip shows it travelling back level.
      await api.advance(TAIL);

      // Tilted: clock at 0.75 s rotates the obstacle ~45deg — the oriented face
      // deflects the same horizontal shot well off-axis (a large vertical component
      // appears).
      //
      // Reopened with startMatch/serve rather than reset(): a reset would return the
      // obstacle clock to 0, and posing it back to 0.75 is the whole point of this
      // second shot. Neither control op disturbs it.
      await api.call("startMatch", "versus");
      await api.call("serve");
      await api.call("setObstacleClock", 0.75); // seconds, not ticks
      tilted = await shootHorizontalAtObstacleA(api);
      // Hold on the deflected return so the clip shows the oriented angle — the
      // second half of the contrast the item is built on.
      await api.advance(TAIL);
    },

    async assert(api, check) {
      check.expectOk("the upright obstacle is struck", upright.hit);
      check.expectClose(
        "an upright obstacle reflects a horizontal shot straight back (vy)",
        upright.outVy,
        0,
        40,
      );

      const tiltDeg = ((Math.abs(tilted.obs.theta) * 180) / Math.PI) % 90;
      check.expectGt(
        "the obstacle is clearly tilted off-axis (deg)",
        tiltDeg,
        20,
      );
      check.expectLt("the obstacle is not axis-aligned (deg)", tiltDeg, 70);
      check.expectOk("the tilted obstacle is struck", tilted.hit);
      check.expectGt(
        "a tilted obstacle deflects the same horizontal shot off-axis, tracking its orientation (vy)",
        Math.abs(tilted.outVy),
        120,
      );
    },
  };
}
