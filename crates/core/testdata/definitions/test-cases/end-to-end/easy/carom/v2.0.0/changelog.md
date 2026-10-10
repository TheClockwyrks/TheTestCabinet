## Added the `window.__carom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires every build to expose a
`window.__carom` debug and automation API — plus a read-only state overlay toggled
with the backtick key — backed by a render-free core with seedable randomness so a
scenario replays identically. A new mandatory deliverable, hence the major bump.

## Every mechanical review point is checked by an automated script

Each graded point now carries a validation script that drives the real build
through the debug handle and decides the point, leaving feel and art to human
review. A new Color category samples the pixels the build actually paints at known
on-field locations rather than trusting reported values, audio cues are verified by
reading the Web Audio sources the build fires, and Beatable AI is checked by
scripted shots the AI must or must not reach.

## Reviewer checklist regrouped into categories

The checklist is now categories of one-point sub-items with no fractional scoring,
and previously bundled points are split so a build fails exactly the rule it breaks.

## Other changes

- `M` toggles mute on any screen, and `snapshot` reports a `muted` flag.
- The prompt no longer mandates a verification pass; Playwright and Chromium are
  noted as available for driving the build, with their use left to the model.
- `specs/proof.md` notes that the debug API can set up the exact state each capture
  needs, so only the setup is fast-forwarded.
- Rewrote the specs in plainer prose, dropping test-framing and heavy emphasis
  while leaving the rules themselves unchanged.
