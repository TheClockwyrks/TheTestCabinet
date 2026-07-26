// Movement: releasing the direction key stops the worker at once — no sliding. Movement
// is read directly from held input each step, so a released key means zero displacement.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot while the key was held and the one taken after the release.
  let moving;
  let after;
  let xAtRelease;

  return {
    id: "movement.no-momentum",

    // Pose the worker on open ground with room to walk right.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 6, 12);
    },

    // Walk, then release and keep running time. The whole point is that the SAME
    // stretch of time either side of the release produces travel and then none, so both
    // legs are 18 ticks (= the old 0.3s). Walk-then-stop is exactly the behavior under
    // test, so this is also all the clip needs to show.
    async act(api) {
      await api.call("keyDown", "KeyD");
      await api.advance(18);
      moving = await api.snapshot();

      await api.call("keyUp", "KeyD");
      xAtRelease = moving.worker.x;
      await api.advance(18); // the same stretch again, now with nothing held
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the worker is moving while the key is held",
        moving.worker.moving,
        true,
      );
      check.expectClose(
        "the worker does not slide after release (Δx)",
        after.worker.x - xAtRelease,
        0,
        0.01,
      );
      check.expectEq(
        "the worker is no longer moving",
        after.worker.moving,
        false,
      );
    },
  };
}
