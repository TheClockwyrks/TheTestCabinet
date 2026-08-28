// controls.setmaze-houses-predators: `setMaze` rebuilds the den from the posed layout and
// puts every predator back into it — and holds them there.
//
// `specs/instrumentation.md` fixes both halves. The op rebuilds everything derived from the
// new layout, "the den and its gate" among them, and leaves the board "in the state a
// freshly generated maze starts in", where "every predator is returned to the den and held
// there exactly as `setPredator(kind, "den")` holds it" — and that mode "HOLDS it there:
// the staggered release schedule is suspended … and it stays in the den chamber until a
// later `setPredator` poses it out, however long the scenario runs".
//
// WHY THIS IS ITS OWN ITEM. Fifty-odd checks pose a fixture and then measure something
// standing on it, and every one of them is only as good as this contract. A build that
// rebuilds the board but leaves its hunters at the coordinates its OWN den used to occupy
// drops them wherever the fixture happens to have put those tiles, which is regularly the
// corridor the scenario is about. One run went exactly that way: a Lanternjaw stood in the
// middle of a posed corridor, ate the forager a quarter of a second in, and three unrelated
// items reported an input bug and a turning bug against a build whose input and turning
// were fine. `poseMaze` now refuses to grade a scenario in that state, which stops the
// misattribution — but a refusal is inconclusive, not a finding, so without this item a
// build could break a required op and have every consequence quietly set aside. This item
// is the one that fails.
//
// It poses with `housed: false` so `poseMaze` leaves the judgement to it rather than
// raising the precondition every other caller gets.
import {
  startPlaying,
  poseMaze,
  housedTiles,
  looseOf,
  pred,
  ticksFor,
} from "../_helpers.mjs";

// An ordinary fixture — a plain corridor. What it holds does not matter; what matters is
// the den `stampLayout` seals into the bottom rows of every fixture, which is where the
// predators belong once the board is posed.
const CORRIDOR = ["S......"];

// How long the den is watched after the board is posed. Past the `10 s` the third
// predator would be due at on an ordinary board (`specs/predators.md`), so a build that
// runs its release schedule anyway — which this op says it must not — is caught rather
// than merely not yet observed.
const WATCH = ticksFor(12);

export default function item() {
  let atPose;
  let atEnd;
  let escaped = [];

  return {
    id: "controls.setmaze-houses-predators",

    async arrange(api) {
      await startPlaying(api);
      await poseMaze(api, CORRIDOR, { housed: false });
    },

    async act(api) {
      const snap = await api.snapshot();
      const housed = housedTiles(snap);
      atPose = { housed, loose: looseOf(snap, housed), dens: housed.size };
      // Watch the den rather than reading it once: the claim is that they are HELD, and a
      // build that puts them away correctly and then releases them on the ordinary
      // schedule has not held them. Sampled across the whole watch so whoever leaves is
      // named, not just whoever happens to be out at the end.
      const seen = new Map();
      for (let spent = 0; spent < WATCH; spent += ticksFor(0.25)) {
        await api.advance(ticksFor(0.25));
        const s = await api.snapshot();
        for (const l of looseOf(s, housed)) if (!seen.has(l.kind)) seen.set(l.kind, l.where);
        atEnd = s;
      }
      escaped = [...seen.values()];
    },

    async assert(api, check) {
      // The fixture carries a den at all — if this fails the fixture is wrong, not the
      // build, and the assertions below would be meaningless.
      check.expectOk(
        `the posed layout carries a den for them to be returned to (${atPose.dens} den/gate tiles)`,
        atPose.dens > 0,
      );
      if (!atPose.dens) return;
      check.expectOk(
        "setMaze returns every predator to the posed layout's den" +
          (atPose.loose.length
            ? ` — ${atPose.loose.map((l) => l.where).join("; ")}`
            : ""),
        atPose.loose.length === 0,
      );
      check.expectOk(
        "and holds them there, with the release schedule suspended" +
          (escaped.length ? ` — ${escaped.join("; ")} left it` : ""),
        escaped.length === 0,
      );
      // AND THIS IS THE ASSERTION THAT IS NOT VACUOUS. Every fixture's den is sealed —
      // `stampLayout` walls the gate on three sides precisely so a build that runs the
      // release schedule anyway cannot reach the scenario — which means the assertion above
      // is partly held up by the geometry rather than by the build. A hunter that tries to
      // leave and is stopped by rock looks exactly like one that was held. The flag is the
      // only thing that tells them apart: the schedule is suspended, so no release time
      // arrives, so nothing is released. A build that re-arms the ordinary schedule reports
      // it here and would walk its predators out of any fixture that was not sealed.
      const released = (atEnd?.predators ?? [])
        .filter((p) => pred(atEnd, p.kind)?.released === true)
        .map((p) => p.kind);
      check.expectOk(
        "and none of them counts its turn as having come while it is held" +
          (released.length ? ` — ${released.join(", ")} reports released` : ""),
        released.length === 0,
      );
    },
  };
}
