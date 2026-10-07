/*
 * Facet — the ONE-SHOT half of the page's audio probe. CASE-PROVIDED.
 *
 * WHY THIS EXISTS. `specs/ui.md` puts two kinds of sound under this game and
 * says different things about them: nine one-shot CUES, each "played on the frame
 * its event happens", and two looping music BEDS, one of which "is playing on
 * every screen". A check about a cue therefore has to be able to say that a frame
 * made no sound — and a bed starting as a screen changes would answer for the cue
 * if the two were counted together. `audio/cue-select` is the sharpest case: it
 * poses a settled board, drives quiet frames, and asserts that not one one-shot
 * sounded before the press.
 *
 * WHAT THE SHARED PROBE COUNTS. `@clockwyrks/case-harness`'s `audio-init.js`
 * watches the two doors a browser can emit sound through — a Web Audio source
 * being `start()`ed and a media element being played — and counts EVERY start in
 * `started()`, with the looping ones counted a second time in `loopStarts()`. It
 * is right to count them all: it cannot know which of a case's sounds are beds,
 * and a case whose specification never separates them wants the total.
 *
 * WHAT THIS ADDS. A second, narrowed handle standing beside it, whose `started()`
 * is the ONE-SHOTS alone. `harness.ts` names it as the case's
 * `CaseConfig.audioGlobal`, so the count the shared harness reads on both sides
 * of every driven frame — and stamps onto that frame — is a count of CUES. The
 * beds are read off `loopStarts()`, which passes through unchanged, at the
 * boundary of each drive.
 *
 * IT WRAPS AND NEVER REPLACES. Nothing here re-wraps `start` or `play`: doing so
 * would count a sound twice, and the two counters would disagree about the same
 * event. This is a reading of the shared probe's own state and nothing else,
 * which is why it can be injected after it and why the two can never drift.
 *
 * Injected as an `extraInitScript`, so it runs after the package's own two and
 * before a line of the build's script. Nothing here is ever seeded into a run.
 */
(() => {
  const probe = window.__tcabAudio;
  if (probe === undefined) {
    // The package's own probe is injected immediately before this script, so it
    // is always there — and if it ever is not, the harness's per-frame counter
    // has nothing to read and every audio reading in the project is silently
    // zero. A handle that FAILS says which of the two scripts did not run;
    // leaving the global absent instead would surface as a TypeError from inside
    // the package's own frame evaluation, naming neither.
    const missing = () => {
      throw new Error(
        "facet: window.__tcabAudio is absent, so audio-cues.js has no probe " +
          "to narrow — the shared harness's audio-init.js did not run",
      );
    };
    window.__facetCues = {
      started: missing,
      looping: missing,
      loopStarts: missing,
    };
    return;
  }

  window.__facetCues = {
    /**
     * How many ONE-SHOT sounds the build has emitted since the page loaded.
     *
     * The total less the looping starts. Both counters only ever rise, and a
     * looping start raises both, so the difference is exactly the sounds that
     * were not beds — and it is monotonic, which is what the harness's
     * read-either-side-of-a-frame accounting requires.
     */
    started: () => probe.started() - probe.loopStarts(),

    /** How many sources are still live AND set to loop, unchanged. */
    looping: () => probe.looping(),

    /** How many of the sounds emitted were looping when they started, unchanged. */
    loopStarts: () => probe.loopStarts(),
  };
})();
