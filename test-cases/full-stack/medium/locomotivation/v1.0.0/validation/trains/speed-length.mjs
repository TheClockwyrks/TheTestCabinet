// Trains: the freight (slow, long), commuter (medium), and bullet (fast, short) each run
// at their own speed and length. One of each is spawned on a distinct lane and advanced a
// real second; the displacement of each head confirms its speed and the snapshot its length.

import { startFresh, TRAIN } from "../_helpers.mjs";

const LANES = [
  [3, "freight"],
  [6, "commuter"],
  [12, "bullet"],
];

export default function item() {
  // The snapshot after one second of travel.
  let snap;

  return {
    id: "trains.speed-length",

    // Enter level 1; the three trains are spawned in `act` so the clip opens on an empty
    // yard and then shows all three running at visibly different speeds side by side.
    async arrange(api) {
      await startFresh(api, 1);
    },

    async act(api) {
      for (const [line, kind] of LANES) {
        await api.call("spawnTrain", {
          line,
          orientation: "horizontal",
          dir: "east",
          kind,
          headPos: 0,
        });
      }

      await api.advance(60); // 60 ticks = the old 1.0s — one real second of travel from headPos 0
      snap = await api.snapshot();

      // Keep filming so the reviewer can see the three speeds diverge, which a single
      // second barely shows. 54 ticks = the old 900ms clip hold.
      await api.advance(54);
    },

    async assert(api, check) {
      const byLine = (line) => snap.trains.find((t) => t.line === line);

      for (const [line, kind] of LANES) {
        const t = byLine(line);
        check.expectOk(`the ${kind} is on its lane`, !!t);
        if (!t) continue;
        check.expectEq(`the ${kind} kind`, t.kind, kind);
        check.expectClose(`${kind} speed`, t.speed, TRAIN[kind].speed, 0.01);
        check.expectClose(`${kind} length`, t.length, TRAIN[kind].length, 0.01);
        check.expectClose(
          `${kind} advanced one second at its speed`,
          t.headPos,
          TRAIN[kind].speed,
          0.5,
        );
      }
    },
  };
}
