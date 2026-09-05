/*
 * A case's init script standing BEFORE the harness's own instrumentation.
 *
 * The position `CaseConfig.preInitScripts` exists for, and the one that is easy
 * to get silently wrong: `recorder-init.js` replaces
 * `HTMLCanvasElement.prototype.getContext` with one that hands back a recording
 * proxy, so a case script that needs the page's REAL `getContext` — spectra's
 * `raster-init.js` takes it for the probe it measures a fill's opacity on — has
 * to have taken it first.
 *
 * What it records is the two facts that tell the two positions apart: whether the
 * harness's own globals were already standing when it ran, and which
 * `getContext` it was handed. `init-scripts.spec.ts` reads both back.
 */
(() => {
  globalThis.__initProbe = globalThis.__initProbe ?? [];
  globalThis.__initProbe.push({
    name: "pre",
    sawRecorder: typeof globalThis.__tcabRec === "object",
    sawAudio: typeof globalThis.__tcabAudio === "object",
    getContext: HTMLCanvasElement.prototype.getContext,
  });
})();
