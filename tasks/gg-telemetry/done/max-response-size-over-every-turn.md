# Max Response Size Covers Every Turn

`maxResponseChars` and `maxResponseOutputTokens` report the largest response the
model produced, over every turn that did not hit the length cutoff.

## Current behaviour

`crates/gg/src/summary.rs` folds the maximum over turns whose outcome was
`progressed` or `finished`, so a turn that errored is dropped from the fold.

The exclusion is correlated with the arm. A compiled arm fails more often and
fails on its longest programs, so the arms most likely to produce a large
response are the arms most likely to have it excluded. Measured across six runs
of one test case that differ only in program language:

| arm        | reported | largest response | dropped because  |
| ---------- | -------- | ---------------- | ---------------- |
| typescript | 4,858    | 21,089           | the turn errored |
| javascript | 16,980   | 16,980           |                  |
| python     | 22,987   | 22,987           |                  |
| csharp     | 19,718   | 19,718           |                  |
| purescript | 19,601   | 19,601           |                  |
| purescript | 19,474   | 19,474           |                  |

Every arm wrote one large program. The reported figure puts TypeScript at a
quarter of its peers, and the true figures put it in the middle.

## Design

Fold over every turn whose response did not hit the length cutoff, whatever the
turn's outcome. Bring
`apps/docs/src/content/docs/gg/telemetry/turn-outcomes.md` onto the new rule.

The same page describes `responseChars` as the response's raw text. The figure
also carries the `submit_program` program strings, which under responses-as-code
are nearly all of it. Correct the description.

## Done when

- [x] The fold covers every turn that did not hit the length cutoff.
- [x] The telemetry documentation states the fold's rule and what `responseChars` measures.
- [x] Gates green.
