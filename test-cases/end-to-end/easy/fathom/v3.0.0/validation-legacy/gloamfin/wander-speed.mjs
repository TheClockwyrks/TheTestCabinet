// gloamfin.wander-speed: it wanders at ~116 px/s with no wind-up over time.
//
// The lone wanderer is posed instantly (`arrange`); the two readings a second apart —
// which is what "no wind-up over time" means — are the real sim, so they are `act`.
import {
  PREDATOR_SPEED,
  denAllExcept,
  sceneGuard,
  sceneHeld,
  poseApart,
  pred,
  quietBoard,
  showOverlay,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let quiet;
  let guard;
  let a;
  let b;

  return {
    id: "gloamfin.wander-speed",

    async arrange(api) {
      await startPlaying(api);
      // A posed board: the forager's corridor, and 8 tiles off across solid
      // rock a separate ring to patrol. Sealed off rather than merely distant, so
      // "far away" holds for the whole watch instead of only until the patrol
      // arrives — a real maze is one connected region and cannot offer that.
      const far = (await poseApart(api, 8)).far; // far, so it just wanders
      quiet = await denAllExcept(api, ["gloamfin"]);
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
      // the wander it measures happens eight tiles away in the dark, so the clip would
      // otherwise be a black screen; the overlay reports its state and speed on the
      // frame without touching the simulation (see `showOverlay`).
      await showOverlay(api);
      guard = await sceneGuard(api, quiet);
    },

    async act(api) {
      await api.advance(24); // 24 ticks = the old 0.2 s
      a = pred(await api.snapshot(), "gloamfin").speed;
      await api.advance(120); // 120 ticks = the old 1.0 s
      b = pred(await api.snapshot(), "gloamfin").speed;
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      // Was the scenario still standing when the measurement ended? If not, the label
      // says what gave way, rather than reporting it against the subject.
      const broke = sceneHeld(await api.snapshot(), guard);
      check.expectOk(broke ?? "the scenario held to the end", !broke);
      if (broke) return;
      check.expectClose("wanders at ~116 px/s", a, PREDATOR_SPEED, 8);
      check.expectClose(
        "no speed wind-up over time (still ~116 px/s)",
        b,
        PREDATOR_SPEED,
        8,
      );
    },
  };
}
