// audio/mute-toggles-during-a-run — the editor reads mute in every sim status.
//
// THE RULE. `specs/editor.md` says it of a run in any status: "While a run is
// active, IN ANY STATUS, a press on the field or the tape panel sets the focus
// alone, and the editor reads the run controls above AND `mute` and nothing
// else." `specs/controls.md` says it row by row: "`editor`, `running` or `paused`
// | `play`, `step`, `speed-up`, `speed-down`, `back`, `mute`", and "`editor`,
// `faulted` or `complete` | `back` and `mute`, and `up`, `down`, and `confirm`
// while the solved panel of `specs/ui.md` is up." Between them they name all four
// statuses `specs/simulation.md` fixes — "`sim.status` is one of `running`,
// `paused`, `faulted`, and `complete`" — and `mute` is on every one of them,
// which is what "Toggles sound, from any screen" already implied.
// `specs/ui.md` says what the press does, and `specs/state.md` names the field it
// lands in: "`muted` — the game's readable copy of the engine's mute bit, which
// every `update` carries into the state it returns."
//
// SO THE POINT IS READ FOUR TIMES, once in each status, each on a world posed for
// it: a run turning on an idle arm (`running`), the same run held with
// `setPaused` (`paused`), a run frozen by the `overextended` fault of
// `specs/simulation.md` (`faulted`), and a run whose only set's tally was posed at
// the challenge's target (`complete`).
//
// AND EACH STATUS IS ENTERED WITH SOUND ON. `mute` toggles, so a check that
// pressed it four times running would be reading `true`, `false`, `true`,
// `false`. Each status therefore presses TWICE: the first press is the verdict,
// the second puts the bit back where the next status needs it — a pose rather
// than a verdict, and the point that decides what the second press does is
// `mute-toggles-back-off`.
//
// THE VERDICT. In each of the four statuses `muted` is `true` in the snapshot
// after the press, and the status the game was in is the status it was still in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ARM_MAX_LEN,
  CONSTELLATION_TARGET,
  type SimStatusName,
} from "../constants";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  openRun,
  openTitle,
  pauseRun,
  pressAction,
  type Harness,
} from "../harness";

/** One arm at rest, whose empty tape moves nothing: a run that just turns. */
const IDLE_ARM = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

/** One piston already at its maximum, told to extend: the overextended fault. */
const OVEREXTENDING = solution([
  armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["extend"]),
]);

/** One set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** What one status reported. */
interface Pressed {
  /** The status the run was in when the key was pressed. */
  status: SimStatusName | undefined;
  /** Whether sound was on before it. */
  before: boolean;
  /** Whether sound was off after it. */
  after: boolean;
  /** The status the run was in afterwards. */
  held: SimStatusName | undefined;
  /** Whether the second press put the bit back, which poses the next status. */
  restored: boolean;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Press `mute` on the run as it stands, then press it back, and report both. */
async function pressHere(): Promise<Pressed> {
  const opening = await h.snapshot();
  const after = await pressAction(h, "mute");
  const restored = await pressAction(h, "mute");
  return {
    status: opening.sim?.status,
    before: opening.muted,
    after: after.muted,
    held: after.sim?.status,
    restored: restored.muted,
  };
}

it("reports muted true after a press in each of the four sim statuses", async () => {
  await openTitle(h);

  const pressed = await captureReplay(h, "running", async () => {
    await openBareRun(h, { challenge: BARE, machine: IDLE_ARM });
    const running = await pressHere();

    await pauseRun(h);
    const paused = await pressHere();

    await openBareRun(h, { challenge: BARE, machine: OVEREXTENDING });
    await advanceCycles(h, 1);
    await h.advance(1);
    const faulted = await pressHere();

    await openRun(h, { challenge: BARE, machine: ONE_SET });
    await h.debug.setTally(0, CONSTELLATION_TARGET);
    await advanceCycles(h, 1);
    await h.advance(1);
    const complete = await pressHere();

    return { running, paused, faulted, complete };
  });

  for (const [status, reading] of Object.entries(pressed)) {
    assertEqual(
      reading.status,
      status,
      `the world posed for the ${status} reading is a run in that status`,
    );
    assertEqual(
      reading.before,
      false,
      `sound is on before the ${status} press, so what is read after it is the press's own work`,
    );
    assertEqual(
      reading.after,
      true,
      `the mute action pressed while a run is ${status} reports muted true in the next snapshot`,
    );
    assertEqual(
      reading.held,
      status,
      `and left the run in the status it was in: mute is not one of the run controls`,
    );
    assertEqual(
      reading.restored,
      false,
      `the second press put sound back on, which is how the next status is posed with it on`,
    );
  }
});
