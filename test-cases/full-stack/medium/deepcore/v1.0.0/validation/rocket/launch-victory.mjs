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
      await api.call("launch");
      await api.advance(180); // 180 ticks = 3 s: the launch sequence resolves to Victory
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("all five components are installed", installed, 5);
      check.expectEq("launching wins the game", snap.screen, "victory");
      check.expectOk("a run summary is shown", !!snap.summary);
    },
  };
}
