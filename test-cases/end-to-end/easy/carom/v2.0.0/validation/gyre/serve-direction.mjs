// Automated validation for the gyre variant's Gyre sub-item `serve-direction`.
//
// Gyre serves toward the receiver exactly as the base variant does (only the
// obstacles differ), so it runs the same shared serve-direction check — the first
// serve of every match goes toward player one, and after a point the serve travels
// toward the player just scored on. Only the verdict id differs from base's copy.
// See validation/_helpers.mjs.

import { serveDirectionCheck } from "../_helpers.mjs";

export default async function drive(api) {
  const { pass, note } = await serveDirectionCheck(api);
  return {
    verdicts: { "gyre.serve-direction": pass },
    notes: { "gyre.serve-direction": note },
  };
}
