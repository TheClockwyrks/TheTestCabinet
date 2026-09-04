// Arc Foundry — audio/kill: the kill cue sounds on the frame a unit dies, and on
// no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.kill` is played when
// "a unit dies", and each cue is played "on the update its event happens, and at
// most once on that update".
//
// THE SCENARIO. One Scrap Capacitor, one held Mote posed to one health so a single
// shot removes it, and one further Mote held at the map's entry and out of every
// range so the live wave cannot clear underneath the reading. The unit is killed by
// a real shot rather than by posing its health to nothing, because the event the
// cue is bound to is the game's own.
//
// WHERE THE LISTENING STARTS, AND WHY. After the shot has been fired. The frame the
// structure fires carries its own firing cue (`specs/ui.md`), so listening from
// before it would hear that sound and have no way to tell it from this one — the
// name of a sound is not observable from outside an engineless build. From the
// frame after the shot until the projectile arrives, the specification names no
// event at all, so that stretch must be silent and the frame the unit is removed
// must not be.
//
// WHAT CANNOT BE SEPARATED. A build that plays the WRONG cue on the right event.
// That half is the reviewer's, by ear, and `audio/cue-files-distinct` is what makes
// it possible.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  watchCues,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, beforeFrame, onFrame, settle } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the unit dies, and not between the shot and the kill", async () => {
  await openYard(h, { wave: 1 });
  await settle(h);
  await holdWaveOpen(h);
  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const victim = await parkUnit(h, "mote", TARGET, { hp: 1 });

  const kill = await captureReplay(h, "kill", async () => {
    const shot = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(3),
    });
    // Listening starts here: the firing cue has already sounded, and nothing the
    // specification names happens again until the shot arrives.
    const cues = watchCues(h);
    const died = await h.until((s) => !s.units.some((u) => u.id === victim), {
      maxFrames: ticks(2),
    });
    return { fired: shot.hit, died: died.hit, frame: h.frame(), cues };
  });

  assertEqual(
    kill.fired,
    true,
    "a Scrap Capacitor with a unit inside its range to fire within three " +
      "seconds (specs/components.md)",
  );
  assertEqual(
    kill.died,
    true,
    "a Scrap Capacitor's shot, which deals 6, to remove a Mote posed to one " +
      "health (specs/components.md)",
  );
  assertDeepEqual(
    beforeFrame(kill.cues, kill.frame).map((cue) => cue.frame),
    [],
    "nothing to sound between the shot and the kill, where the specification " +
      "names no event (specs/ui.md)",
  );
  assertGreaterThan(
    onFrame(kill.cues, kill.frame).length,
    0,
    "a cue to sound on the frame a unit dies (specs/ui.md)",
  );
});
