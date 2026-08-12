// maze-movement.no-den-gate: the forager cannot swim through the den gate into the den.
//
// The gate is passable only by predators (specs/maze.md, specs/movement.md): the
// forager can never enter the den. Finding the open tile just outside a gate and placing
// the forager there is instant (`arrange`); the held key that fails to carry it through
// the gate is the real sim, so it is `act`. All predators are parked in the den so none
// exits onto the forager during the measurement. The key stays held through the tail so
// the clip shows the forager pressed against the closed gate, going nowhere.
import {
  startPlaying,
  findGateApproach,
  denAllExcept,
  DIR_KEY,
} from "../_helpers.mjs";

export default function item() {
  let dir;
  let before;
  let after;
  let screen;

  return {
    id: "maze-movement.no-den-gate",

    async arrange(api) {
      const snap = await startPlaying(api);
      const approach = findGateApproach(snap);
      dir = approach.dir;
      // Keep every predator in the den so none leaves through the gate onto the
      // forager while it is held against it (the gate is the predators' exit).
      await denAllExcept(api, []);
      // Face the gate. `setForager` keeps the forager's existing facing when none is
      // given, so without this the outcome would turn on whichever way it happened to be
      // pointing — a forager already facing along the corridor is entitled to keep going
      // that way when the key it is holding leads into rock (specs/movement.md).
      await api.call("setForager", {
        tx: approach.tx,
        ty: approach.ty,
        dir,
      });
    },

    async act(api) {
      before = (await api.snapshot()).forager;
      await api.call("keyDown", DIR_KEY[dir]);
      await api.advance(36); // 36 ticks = 0.3 s driving into the gate
      const snap = await api.snapshot();
      after = snap.forager;
      screen = snap.screen;
      await api.advance(36); // 36 ticks of the key still held, for the clip
      await api.call("keyUp", DIR_KEY[dir]);
    },

    async assert(api, check) {
      // The forager is pressed against the predators' own exit, so a predator that
      // leaves the den during the measurement lands on top of it and costs a life —
      // which moves the forager to its respawn tile and would read as it having gone
      // somewhere. `denAllExcept` parked them all first, so this only trips when
      // `setPredator` mode 'den' does not actually hold a predator in the den (a
      // predator returned to the den re-releases on the staggered schedule,
      // specs/predators.md). Report that plainly rather than as a gate failure.
      check.expectOk(
        "the predators stayed in the den for the measurement (nothing ate the forager)",
        screen === "playing",
      );
      if (screen !== "playing") return;
      check.expectEq(
        "the forager stays on its tile against the closed den gate",
        `${after.tx},${after.ty}`,
        `${before.tx},${before.ty}`,
      );
      check.expectOk(
        "the forager does not swim through the den gate (not moving)",
        after.moving === false,
      );
    },
  };
}
