// gloamfin.ping-cadence: while wandering it emits its own violet ping ~every 4 s.
//
// Posing a lone wandering Gloamfin far from the forager is instant (`arrange`); the watch
// that collects its pings is the measurement, so it is `act` and is what the clip opens
// on (the record pass films the start of the watch and stops on its budget).
import {
  GLOAMFIN_PING_INTERVAL,
  actGloamPings,
  denAllExcept,
  sceneGuard,
  sceneHeld,
  poseApart,
  quietBoard,
  showOverlay,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let quiet;
  let guard;
  let pings;

  return {
    id: "gloamfin.ping-cadence",

    async arrange(api) {
      await startPlaying(api);
      // A posed board: the forager's corridor, and 10 tiles off across solid
      // rock a separate ring to patrol. Sealed off rather than merely distant, so
      // "far away" holds for the whole watch instead of only until the patrol
      // arrives — a real maze is one connected region and cannot offer that.
      const far = (await poseApart(api, 10)).far; // far, so it wanders and self-pings
      quiet = await denAllExcept(api, ["gloamfin"]);
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
      // the Gloamfin must sit beyond its own ping range, far out in the dark, so the clip would
      // otherwise be a black screen; the overlay reports its state and speed on the
      // frame without touching the simulation (see `showOverlay`).
      await showOverlay(api);
      guard = await sceneGuard(api, quiet);
    },

    async act(api) {
      // 1080 ticks = the old collectGloamPings(api, 9): a 9 s watch.
      pings = await actGloamPings(api, ticksFor(9));
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      // Was the scenario still standing when the measurement ended? If not, the label
      // says what gave way, rather than reporting it against the subject.
      const broke = sceneHeld(await api.snapshot(), guard);
      check.expectOk(broke ?? "the scenario held to the end", !broke);
      if (broke) return;
      const violet = pings.filter((p) => p.tint === "violet");
      check.expectGt(
        "the Gloamfin emits its own violet pings",
        violet.length,
        0,
      );
      if (violet.length >= 2) {
        const gap = violet[1].t - violet[0].t;
        check.expectClose(
          "its ping cadence is ~4 s",
          gap,
          GLOAMFIN_PING_INTERVAL,
          1.5,
        );
      }
    },
  };
}
