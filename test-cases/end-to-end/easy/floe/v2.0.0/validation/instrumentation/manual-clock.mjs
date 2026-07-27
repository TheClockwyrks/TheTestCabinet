// Automated validation for the Instrumentation item `manual-clock`.
//
// The debug API's clock contract (specs/instrumentation.md): `reset()` and `step()`
// switch the game to manual stepping, and from there `step` is the ONLY thing that
// moves the simulation until `setAutoStep(true)` hands the clock back. No other
// operation touches it — the control ops pose the world, they do not start it
// running. That is what makes a scripted scenario exact and reproducible, which
// specs/gameplay.md states outright: "given the same seed and the same sequence of
// inputs and steps, the game reaches the same state every time".
//
// This is checked directly because nothing else can see it. A build that resumes its
// own clock inside a control op plays perfectly for a person — a game running in real
// time is exactly what a player expects — and it answers every call the API declares,
// so a surface conformance probe finds nothing wrong either. What it breaks is
// reproducibility: the world keeps moving between the driver's calls, for however long
// the round trips happen to take, so a posed scenario reaches its measurement in a
// state nobody asked for, and a different one on each run.
//
// So this item earns its place twice over. It scores a real spec violation that would
// otherwise cost the build nothing; and it names the cause of any downstream oddity,
// because the corruption does not announce itself — it surfaces as some OTHER check
// reporting a defect that is not there (a posed death that resolved before the
// measurement began) or missing one that is (a stray tick refreshing a stale value the
// check meant to catch). Without this item a reviewer reads those at face value.
//
// THE CONTROL OP UNDER TEST IS CALLED FROM `act`, NOT `arrange`, and that is the whole
// design of the item rather than a detail. The runtime puts the build on its manual
// clock between `arrange` and `act` (see `runPass` in
// `packages/browser-driver/validation.mjs`), so a violation committed during `arrange`
// has already been corrected by the time `act` could observe it. An item that posed in
// `arrange` and measured in `act` would watch a perfectly still clock on a build that
// badly breaks the contract, and pass. The op has to run here, after the runtime's
// last correction, where its effect on the clock is still visible.

// How long to let real time pass while the simulation is supposed to be frozen. Long
// enough that a free-running build advances unmistakably (at 120 Hz this is ~30 ticks,
// a quarter-second of game time) and short enough to stay cheap.
const IDLE_MS = 250;

// How much simulation time may accumulate over that idle and still count as stopped,
// in seconds. A conformant build advances EXACTLY zero — nothing steps it — so any
// tolerance at all is generosity; this allows a couple of stray ticks rather than
// demanding bit-exact stillness, while a free-running build shows an order of
// magnitude more.
const STILL_S = 0.05;

// A second of game time, in ticks, and the tolerance for `step` landing on it.
const ONE_SECOND_TICKS = 120;
const EXACT_S = 1e-6;

export default function item() {
  // How far the sim drifted over each idle, and what one second of stepping moved.
  let driftAfterStart;
  let driftAfterPose;
  let steppedOneSecond;

  return {
    id: "instrumentation.manual-clock",

    // Only `reset`, which the contract itself puts on the manual clock. Everything
    // this item tests happens in `act`, for the reason given above.
    async arrange(api) {
      await api.reset();
    },

    // Three observations, all here because two of them spend real time.
    //
    // `api.settle` is a REAL pause in both passes, deliberately: `advance` would ask
    // the build to step, which is the very thing that must not be happening. The point
    // is to let the wall clock run while the simulation is under orders to hold still.
    async act(api) {
      // 1. After `startGame` — the control op most likely to resume an animation loop,
      //    since it is the one that starts a run, and a run is when there is something
      //    to advance.
      await api.call("startGame");
      const t0 = (await api.snapshot()).simTime;
      await api.settle(IDLE_MS);
      driftAfterStart = (await api.snapshot()).simTime - t0;

      // 2. After posing with the control ops an arrange actually uses. Any of them
      //    resuming the clock breaks a scenario just as thoroughly.
      await api.call("setLane", 15, { cols: [] });
      await api.call("placeCritter", 20, 15);
      await api.call("setBear", 0, { col: 20, row: 18 });
      const t1 = (await api.snapshot()).simTime;
      await api.settle(IDLE_MS);
      driftAfterPose = (await api.snapshot()).simTime - t1;

      // 3. And the other half of the contract: when time IS asked for, exactly that
      //    much arrives — `step(120)` is one second, with nothing left over
      //    (specs/instrumentation.md: no rounding, no accumulation).
      const t2 = (await api.snapshot()).simTime;
      await api.advance(ONE_SECOND_TICKS);
      steppedOneSecond = (await api.snapshot()).simTime - t2;

      // The item's evidence is the drift figures the assertions record, not this
      // still — a clock defect has no appearance. It is a STILL rather than a clip
      // deliberately: the record pass films with the clock handed back (that is what
      // makes every other item's media show real motion), so a video here would show
      // the game running normally whether or not the build conforms, which reads as
      // reassurance it has not earned. The frame just shows the scene that was posed.
      await api.screenshot("clock");
    },

    async assert(api, check) {
      check.expectClose(
        "starting a run leaves the simulation on its manual clock",
        driftAfterStart,
        0,
        STILL_S,
      );
      check.expectClose(
        "posing the world leaves the simulation on its manual clock",
        driftAfterPose,
        0,
        STILL_S,
      );
      check.expectClose(
        "step(120) advances exactly one second of simulation",
        steppedOneSecond,
        1,
        EXACT_S,
      );
    },
  };
}
