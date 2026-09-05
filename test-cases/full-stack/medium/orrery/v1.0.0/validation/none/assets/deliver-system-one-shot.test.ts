// assets/deliver-system-one-shot — the delivery system is authored one-shot.
//
// THE RULE, from The particle effects of `specs/assets.md`: "Each is authored
// one-shot, its timeline set with `set-timeline --loop false`, so it decays to
// empty rather than settling into a steady state, and each is authored radially
// symmetric, so an instance reads correctly wherever on the field it plays." The
// Delivery row names the file this is asked of: `assets/particles/deliver.json`,
// fired at "each set that consumed at least one accepted constellation at this
// boundary, on its anchor hex".
//
// WHY IT IS ASKED. An effect that settles into a steady state never ends, so a
// build that fired one on a busy field would accumulate live instances it has no
// event to stop, and a machine running for a hundred cycles would end up under a
// permanent wash of them. A one-shot ends itself.
//
// WHAT IT READS, AND IN BOTH HALVES OF THE SENTENCE. The timeline's own
// declaration — `loop`, which is what `set-timeline --loop false` writes and
// what the runtime's own types carry — and the consequence the sentence draws
// from it: a seeded play run past the system's own duration emits particles,
// falls to nothing, and never re-fires. A LOOPING timeline recovers from nothing
// at its duration, which is exactly what "settling into a steady state" is, so
// the reading tells the two apart on behaviour as well as on the flag.
//
// WHY THE PLAY RUNS PAST THE DURATION. `specs/assets.md` fixes no lifetime for a
// particle, so a one-shot whose particles outlive the duration its timeline
// declares is conformant and is still decaying — this build's fault system is one.
// The play therefore runs `DECAY_PLAYS` whole durations, which is the runtime's
// own reading of the property, rather than stopping at the first.
//
// WHAT THIS POINT DOES NOT READ. That the file is a system the runtime accepts is
// `deliver-system-produced`; radial symmetry is the art bar and is a reviewer's
// judgement; where and when the build fires it is the presentation category's.
//
// THE EVIDENCE is the play itself as a filmstrip — six moments of one seeded
// instance, each captioned with how many particles were live — so the decay is
// read beside the verdict. Nothing drawn there is read by an assertion.

import { it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue, fail } from "../assert";
import { PARTICLE_FILES } from "./files";
import { DECAY_PLAYS, playSystem, showDecay } from "./systems";

it("authors assets/particles/deliver.json as a one-shot that decays to empty", async () => {
  const play = await playSystem(PARTICLE_FILES.deliver);
  showDecay("decay", play);

  if (play.system === null) {
    fail(
      `a particle system @clockwyrks/particle-runtime accepts at ${play.file}`,
      play.reason,
    );
  }

  assertEqual(
    play.system.loop,
    false,
    "the timeline of assets/particles/deliver.json, which set-timeline --loop false writes as false",
  );
  assertGreaterThan(
    play.peakLive,
    0,
    "the seeded play emitted particles, so the decay below is a decay rather than a system that never fired",
  );
  assertEqual(
    play.liveAtEnd,
    0,
    `particles still live after ${DECAY_PLAYS} whole durations: a one-shot has decayed to empty by then`,
  );
  assertTrue(
    play.settled,
    "and it stayed empty: a timeline that re-fires after it has emptied is settling into a steady state rather than decaying",
  );
});
