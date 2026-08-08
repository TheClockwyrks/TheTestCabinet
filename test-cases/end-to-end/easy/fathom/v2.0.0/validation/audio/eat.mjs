// Automated validation for the Audio item `eat`: a short cue plays when the forager eats
// a plankton. Audio is read from the Web Audio sources the build starts (see `api.audio`).
// Nothing here inspects the sound itself; only that one was scheduled in response to
// an eat.
//
// WHY THE EAT IS SWUM INTO RATHER THAN STOOD ON. Every open tile starts carrying a
// plankton (specs/gameplay.md), so this used to place the forager on a fresh corridor tile
// and step six ticks for the eat under its feet. That makes the whole subject of the item
// something that resolves in the instant the scenario is posed — and posing is exactly the
// part of a check that a build can run out from under. A forager that keeps swimming with
// no key held (`specs/movement.md`) or a build still on its own clock through `arrange`
// (`specs/instrumentation.md`: `reset()` re-arms manual stepping and the control operations
// do not change `autoStep`) travels while the audio is being armed with its real gesture,
// eats the posed tile's pellet and the next one or two on the way, and arrives at `act`
// mid-corridor with nothing under it. The six ticks then contain no eat at all, and the
// item reports a silent eat cue on a build whose eat cue works — which is how a run failed
// this item while the game plainly chimed in the reviewer's hands.
//
// So the forager is stood STILL against rock, where no amount of elapsed time moves it,
// and the measured eat is one it swims into after the clock is the driver's: the key goes
// down, the sweep waits for the plankton count to drop, and the cue is read across that.
// Whatever happened to the pellet it was standing on no longer matters.
import {
  DIR_KEY,
  TICK,
  armAudio,
  audioCount,
  findMoveKeyTile,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let dir;
  let before;
  let after;
  let ate;

  return {
    id: "audio.eat",

    async arrange(api) {
      const snap = await startPlaying(api);
      // Armed first: the gesture is real user input and takes real time, which is time
      // the pose would otherwise have to survive.
      await armAudio(api);
      const spot = findMoveKeyTile(snap, "right");
      dir = "right";
      await api.call("setForager", {
        tx: spot.tx,
        ty: spot.ty,
        dir: spot.facing,
      });
    },

    async act(api) {
      before = await audioCount(api);
      const start = (await api.snapshot()).planktonRemaining;
      await api.call("keyDown", DIR_KEY[dir]);
      // 90 ticks = 0.75 s, three times the 30 ticks the forager needs to cover the tile
      // between it and the next pellet at `128 px/s`. Swept at tick resolution so the read
      // lands on the eat rather than somewhere after it.
      const hit = await api.until((s) => s.planktonRemaining < start, {
        max: 90,
        poll: TICK,
      });
      ate = hit.hit;
      after = await audioCount(api);
      await api.advance(84); // a short tail, key still held, so the clip shows it grazing
      await api.call("keyUp", DIR_KEY[dir]);
    },

    async assert(api, check) {
      check.expectOk("the forager swims into a plankton and eats it", ate);
      check.expectGt(
        "an eat cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
