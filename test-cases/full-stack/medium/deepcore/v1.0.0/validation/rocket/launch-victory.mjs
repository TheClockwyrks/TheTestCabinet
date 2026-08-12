// Automated validation for rocket.launch-victory.
//
// With all five components installed, launching takes the game to Victory — the only win. We supply
// the Credits, both materials, and the Core Sample, fabricate all five, launch, and step through the
// launch sequence.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let installed;
  let snap;

  return {
    id: "rocket.launch-victory",

    // Everything the rocket needs, with all five components already fabricated onto it.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 30000);
      await api.call("giveMaterial", "resonite");
      await api.call("giveMaterial", "cryenite");
      await api.call("spawnCoreSample");
      for (let i = 0; i < 5; i += 1) await api.call("fabricate");
      installed = (await api.snapshot()).rocket.installed.length;
    },

    // The launch and the sequence it plays out are the behavior — and the clip is the win itself.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s on the completed rocket before the launch
      await api.call("launch");
      // Poll until the launch sequence resolves to Victory rather than advancing a fixed span:
      // specs/rocket.md mandates launch -> Victory but bounds no duration for the lift-off
      // animation, so a build is free to make it longer than any single guess. 600 ticks = 10 s
      // is a generous ceiling for any reasonable sequence.
      const r = await api.until((s) => s.screen === "victory", {
        max: 600,
        poll: 6,
      });
      snap = r.snap;
      // Rest on the Victory screen. The sweep above stops on the frame the screen turns over, so
      // without this the clip ends the instant the win lands and the run summary — which this item
      // explicitly asserts is shown — is never on screen to be read. It also makes the clip's
      // length independent of how long a build's lift-off animation runs: the sweep's duration
      // varies per build, this tail does not.
      await api.advance(120); // 120 ticks = 2 s on the Victory screen and its summary
    },

    async assert(api, check) {
      check.expectEq("all five components are installed", installed, 5);
      check.expectEq("launching wins the game", snap.screen, "victory");
      check.expectOk("a run summary is shown", !!snap.summary);
    },
  };
}
