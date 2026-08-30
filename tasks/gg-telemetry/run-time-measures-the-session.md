# Run Time Measures The Model's Session

A run's recorded duration covers the model's session. Container setup and result
verification are recorded separately.

## Current behaviour

The timer starts in `crates/core/src/lib.rs` before reference rendering and host
seeding, and is read after collection and teardown. `runTimeSeconds` therefore
covers `start_container`, `init_test_case`, `install_harness`, the session and
teardown.

In six recorded runs of one test case, setup was between 75% and 89% of the
figure. Four of those runs used four different program languages and their
recorded durations fell within 4% of each other, because the shared setup
dominated each one.

Two surfaces present the figure as a property of the model.
`packages/ui/src/app/pages/gg/dashboards/overviewDashboard.ts` titles a panel
over it "Median session length by model", and
`packages/ui/src/app/pages/models/[modelId]/ModelOverviewPage.tsx` shows a mean
beside mean cost and mean tokens. `metric.runTimeSeconds` is the only time field
on the gg run document, so neither surface has a session figure to read.

## Design

Record the session's own duration as its own metric, and record the setup and
verification stages separately. Point the surfaces that describe the model at the
session figure.

Keep whole-run wall clock available for the questions it answers, under a name
that says what it measures.

## Consequences elsewhere

`apps/docs/src/content/docs/gg/analysis/overview.md` states that the runtime cap
wraps the harness session alone. The cap is resolved once and passed to
`install_harness`, `init_test_case` and the session independently, so each stage
receives the full budget. Correct the page.

## Done when

- [ ] The session's duration is recorded as its own metric on the run document.
- [ ] Setup and verification durations are recorded separately.
- [ ] The console surfaces that describe a model read the session figure.
- [ ] The analysis documentation states what the cap wraps.
- [ ] Gates green.
