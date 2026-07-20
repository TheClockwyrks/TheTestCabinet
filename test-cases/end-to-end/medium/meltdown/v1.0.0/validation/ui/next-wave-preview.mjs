// Automated validation for the UI sub-item `next-wave-preview`.
//
// During a build phase the inspector previews the makeup of the coming wave
// (specs/reactor.md). We read the wave preview in the opening build phase and confirm
// it lists the coming wave's surge types, capturing it for the reviewer.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.next-wave-preview");

  const s = await newGame(api, "containment", "medium");
  check.expectOk("a build phase reports a wave preview", Array.isArray(s.wavePreview));
  check.expectGt("the preview lists at least one coming surge type", s.wavePreview ? s.wavePreview.length : 0, 0);

  await api.wait(80);
  await api.screenshot("preview");
  return check.verdict();
}
