// audio/no-constellation-cue-without-a-consumption — a boundary at which no set
// accepts anything sounds nothing, however busy the rest of the boundary was.
//
// THE RULE. `specs/ui.md` gives the cue one event: "| `constellation` |
// `CUES.constellation` | A SET CONSUMES one or more constellations. |" The other
// things a boundary does are not that event. `specs/simulation.md` lists them:
// "Boundary ... The boundary sequence runs: the sigil phase, then sets, then
// rises, then the area bank, then the completion check." A sigil that fired and a
// rise that spawned are each a boundary doing its work with no set consuming, so
// neither may sound this cue.
//
// THE CONFIGURATION. `PAIRED`, whose product is TWO `luna` joined by a filament,
// opened as a bare run with three parts and two motes, arranged so that every
// wave of the boundary sequence has something to do and the set has nothing:
//
//   * the rise for reagent `0` on `WEST`, which spawns its lone `luna` there at
//     the first boundary its footprint is vacant on — a rise that really fires;
//   * a `bind` sigil on `ORIGIN`, whose two hexes are `(0, 0)` and `(1, 0)`
//     (`specs/sigils.md`), with one `dust` on each: "When both hexes hold motes
//     and no filament joins that pair, a filament of weight `1` is created
//     between them" — a sigil that really fires;
//   * the set for product `0` on `EAST`, whose footprint is nowhere near either,
//     so nothing it could accept is ever on it.
//
// The two `dust` rest `48` apart, which is the rest separation of two motes on
// adjacent hexes and clear of the `38` the collision rule watches, so nothing
// faults. The completion switch is held off.
//
// THE BOUNDARY IS SHOWN TO HAVE RUN. A check whose verdict is a silence passes on
// a build that does nothing at all unless it reads back that the world moved. So
// the filament `bind` created and the mote the rise spawned are both read after
// the cycles, and the set's tally is read as still `0`.
//
// THE VERDICT. Three whole cycles of boundaries later, the sigil has fired and
// the rise has spawned, no tally has moved, and no frame has sounded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { CUES } from "../constants";
import { at } from "../field";
import { risePart, setPart, sigilPart, solution } from "../formats";
import { EAST, ORIGIN, PAIRED, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  resumeRun,
  spawnMote,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import { FENCE_FRAMES, openSilence, soundingFrames } from "./silence";

/** Which of the challenge's products the far-away set receives. */
const PRODUCT = 0;

/** `bind`'s two hexes at rotation 0, which the two dust motes rest on. */
const FIRST = at(0, 0);
const SECOND = at(1, 0);

/** How many cycles of boundaries the check listens over. */
const CYCLES = 3;

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing at boundaries whose sigils fired and whose rises spawned", async () => {
  await openBareRun(h, {
    challenge: PAIRED,
    machine: solution([
      risePart(0, WEST.q, WEST.r, 0),
      setPart(PRODUCT, EAST.q, EAST.r, 0),
      sigilPart("bind", ORIGIN.q, ORIGIN.r, 0),
    ]),
    paused: true,
  });
  const first = await spawnMote(h, FIRST, "dust");
  const second = await spawnMote(h, SECOND, "dust");

  const posed = await h.snapshot();
  assertEqual(
    filamentBetween(posed, first, second),
    null,
    "the pair is unjoined before the boundary, so bind has work to do",
  );
  assertEqual(
    moteAt(posed, WEST),
    null,
    "and the rise's footprint is vacant, so the rise has work to do",
  );

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);

  await captureReplay(h, "silent", async () => {
    await resumeRun(h);
    await advanceCycles(h, CYCLES);
  });

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "three cycles of boundaries ran without faulting or completing",
  );
  assertNotNull(
    filamentBetween(after, first, second),
    "the bind sigil fired: a filament of weight 1 now joins the pair",
  );
  assertEqual(
    moteAt(after, WEST)?.type,
    "luna",
    "and the rise spawned its reagent, so the boundaries really ran their waves",
  );
  assertEqual(
    tallyOf(after, PRODUCT),
    0,
    "no set accepted anything: the far set's tally has not moved",
  );
  assertLength(
    soundingFrames(heard, CUES.constellation),
    0,
    "so no frame sounds the constellation cue",
  );
});
