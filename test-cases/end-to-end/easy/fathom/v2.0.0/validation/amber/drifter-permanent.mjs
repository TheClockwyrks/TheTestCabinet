// amber.drifter-permanent: a drifter persists (does not fade) until eaten.
//
// Spawning the drifter is instant (`arrange`); the stretch of time it has to survive IS
// the check, so it is `act` and is what the clip shows.
//
// HOW THAT STRETCH IS SPLIT, AND WHY IT HAD TO BE. The whole wait used to be one
// `advance(960)` — eight seconds, which is exactly the record pass's filming budget. The
// budget is spent BEFORE the wait rather than during it, so the pass unwound on the first
// call and filmed nothing at all: the clip was the tail end of the setup, a flash of menu
// and no dive, which is precisely what it looked like. Splitting the wait fixes both ends
// of that. The first stretch is `skip` — the same real simulation, run instantly in both
// passes — so the drifter has genuinely been alive a long time by the time anything is
// filmed; the second is `advance`, five seconds the reviewer actually watches an amber
// mote sit there and not fade.
import {
  denAllExcept,
  findFarTile,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let n0;
  let n1;

  return {
    id: "amber.drifter-permanent",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, []); // den all predators so none disturbs the scene
      const far = findFarTile(snap, snap.forager, 10); // far from the stationary forager, so it is not eaten
      await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
      await quietBoard(api);
    },

    async act(api) {
      n0 = (await api.snapshot()).drifters.length;
      await api.skip(720); // 6 s of the wait, run instantly and not filmed
      await api.advance(600); // 5 s of it the reviewer watches
      n1 = (await api.snapshot()).drifters.length;
      await api.advance(60); // 0.5 s tail
    },

    async assert(api, check) {
      check.expectGt("the drifter spawned", n0, 0);
      check.expectGe(
        "the drifter still exists 11 s later (it does not fade)",
        n1,
        n0,
      );
    },
  };
}
