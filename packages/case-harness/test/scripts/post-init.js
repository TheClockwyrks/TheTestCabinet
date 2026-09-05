/*
 * A case's init script standing AFTER the harness's own instrumentation.
 *
 * Where `CaseConfig.extraInitScripts` has always put one, and where everything
 * that only needs to be there before the BUILD belongs. It records the same two
 * facts `pre-init.js` does, so one reading distinguishes the two positions.
 */
(() => {
  globalThis.__initProbe = globalThis.__initProbe ?? [];
  globalThis.__initProbe.push({
    name: "post",
    sawRecorder: typeof globalThis.__tcabRec === "object",
    sawAudio: typeof globalThis.__tcabAudio === "object",
    getContext: HTMLCanvasElement.prototype.getContext,
  });
})();
