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
  let onGate = false;
  let inDen = false;
  let screen = "playing";

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
      // Sampled every tick, for the whole drive: what the item forbids is the forager
      // ever BEING on the gate or inside the den, and a pair of readings taken at either
      // end of the window would miss a forager that slipped through and came back.
      for (let i = 0; i < 72; i++) {
        await api.advance(1);
        const s = await api.snapshot();
        const t = s.tiles[s.forager.ty]?.[s.forager.tx];
        if (t === "g") onGate = true;
        if (t === "d") inDen = true;
        if (s.screen !== "playing") screen = s.screen;
        if (i === 35) after = s.forager; // 0.3 s in, the state the old reading was taken at
      }
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
      // WHAT THIS ASKS, AND WHAT IT DELIBERATELY DOES NOT. The claim is that the gate is
      // shut to the forager — "the gate is passable only by predators" (`specs/maze.md`) —
      // so what it forbids is the forager ever standing ON the gate tile or inside the den
      // chamber. It used to ask for something stricter and unfixed: that the forager be
      // exactly where it started, and not moving. A build that turns its forager aside
      // when the way ahead is rock, rather than stopping it dead, was failed for that —
      // and turning aside is a reading `specs/movement.md` leaves open (a direction key
      // "sets the desired direction", and nothing says what a forager does when that
      // direction is blocked). Such a build is refused by the gate exactly as the spec
      // asks; it just does not stand still about it. The gate is what is under test here,
      // not what a blocked forager does next.
      check.expectOk(
        "the forager never stands on the den gate tile",
        !onGate,
      );
      check.expectOk(
        "and never gets inside the den chamber",
        !inDen,
      );
    },
  };
}
