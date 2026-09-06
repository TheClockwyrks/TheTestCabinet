// cascade/boards-are-solvable — every generated board is solvable, proven by
// solving it.
//
// specs/modes/cascade.md "The generator": "Every board the generator emits is
// solvable under the rules in specs/beams.md". The generator is asked for five
// boards at every tier of the ladder through `generateBoard`
// (specs/instrumentation.md), and each is solved FOR REAL: read off the
// snapshot, cracked by the case's solver — derived from specs/beams.md alone,
// never from any implementation — and its beams traced through the game's own
// pointer path, so the build's own R9 is what says the board is solved. The
// last board, a MAX_TIER board, is solved on camera as the replay.
//
// RESIDUAL RISK, ACCEPTED: the solver carries an expansion cap (a generous
// runaway stop, DEFAULT_MAX_EXPANSIONS = 2,000,000) so a pathological board
// cannot hang the suite. Boards within the ladder's sizes (at most 7x6, 1-3
// channels) resolve in milliseconds; a conformant generator emitting a board
// the solver cannot crack inside the cap would fail this point wrongly, and
// that risk is accepted as vanishingly small rather than hidden.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHANNELS, MAX_TIER } from "../notation";
import { solve } from "../solver";
import {
  captureReplay,
  createHarness,
  drawBeams,
  generateAtTiers,
  traceCells,
  type Harness,
} from "../harness";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves five generated boards at every tier, the last on camera", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round, board }) => {
      const at = `tier ${tier}, board ${round}`;
      const last = tier === MAX_TIER && round === PER_TIER;
      const verdict = solve(board);
      assertEqual(
        verdict.status,
        "solved",
        `the spec-derived solver's verdict on ${at}`,
      );
      if (verdict.status !== "solved") return;

      if (!last) {
        const after = await drawBeams(h, verdict.beams);
        assertEqual(
          after.solved,
          true,
          `the build accepts the traced solution to ${at}`,
        );
        return;
      }

      // The last board, solved on camera: the bare board first, then a frame
      // after each channel's beam lands. Pointer operations drive no frames of
      // their own, so the interleaved advances are what give the recording
      // something to show.
      await captureReplay(h, "solve", async () => {
        await h.advance(1);
        for (const channel of CHANNELS) {
          const route = verdict.beams[channel];
          if (route !== undefined && route.length > 0) {
            await traceCells(h, route);
            await h.advance(1);
          }
        }
      });
      assertEqual(
        (await h.snapshot()).solved,
        true,
        `the build accepts the replayed solution to ${at}`,
      );
    },
  );

  assertEqual(
    generated.length,
    MAX_TIER * PER_TIER,
    "boards generated across the ladder",
  );
});
