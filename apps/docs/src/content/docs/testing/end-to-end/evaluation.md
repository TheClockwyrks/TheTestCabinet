---
title: Evaluation
---

An end-to-end run is scored in two stages: an automated validation pass and a
review written by a person who plays the build. Validation catches gross
failures cheaply and, through the [instrumentation](#instrumentation) a case
requires, drives the build into the states each checklist item needs and decides
its verdict, synthesizing the evidence as it goes. On a
[validator-rated](#rating-channels) case version the validators also decide the
run's functional rating and its score, so both stand the moment the run
completes. The review is where subjective judgement is made: one run-wide
aesthetic rating covering how the whole build looks, sounds, and feels to play.

The mechanism behind each stage lives under Core:
[Validation](/components/core/validation/) for the automated pass and
[Results](/components/core/results/) for publishing and reviews. This page
covers how the two combine into a run's score.

## Load check

The most important automated signal is whether the implementation runs at all.
Validation builds the produced implementation with the manifest's `[build]`
commands, install then build, serves the output directory (`dist/`, `build/`, or
`out/`) as a static site, loads it in a headless browser, and detects fatal
errors. The install and the build are reported as separate results rather than
one opaque step. A run that cannot load is recorded as such, which is the
clearest negative signal available.

## Checks

Reference comparison is opt-in. A case seeds reference views as visual targets,
and a view is scored only when the case declares a
[`[[check]]`](/testing/end-to-end/manifests/) for it. The harness serves the
build, drives it through the check's actions, captures a screenshot, and scores
its similarity against the reference baseline. The result is a similarity signal
recorded with the run rather than a strict match requirement, and a view that
cannot be reached or captured is recorded as not reached. Because driving an
arbitrary implementation into a deep state is unreliable, most cases check only
a few stable views even though they seed more references as targets.

## Proofs

A case can ask the build to produce proof of implementation: a screenshot or
short clip written to a known path as evidence that a feature works, declared
with a [`[[proof]]`](/testing/end-to-end/manifests/). Validation records only
whether each declared proof turned up in the produced tree and is non-empty; it
does not judge the contents. A proof is informational, so a missing one never
changes whether the run loaded or what its status is. It is surfaced so a
reviewer sees the gap, and so the reviewer UI can show the submitted media
beside the expected reference for a review item that pairs them.

A proof the build submits is evidence a reviewer weighs. Media The Test Cabinet
synthesizes itself by driving the build through its
[instrumentation](#instrumentation) is a different thing: it is captured from a
scenario the harness constructed, and it backs an automatically decided verdict.

## Instrumentation

An end-to-end case requires the build to ship
[instrumentation](/testing/end-to-end/instrumentation/): a debug API that puts
the game into a precise state and reports the state it is in, a render-free
core that lets the harness step it, and a read-only debug overlay. This is what
lets validation reach past gross failures. For an objective review item, the
harness resets the build to a known start, calls the case's control operations
to establish the item's precondition, steps the real simulation forward, and
reads the result back, both synthesizing the proof media and deciding the
verdict. Every review item a case declares carries such a script, so behavior is
decided by the case's validators; a reviewer may [override](#review) a verdict,
and doing so is the exception.

The debug API is load-bearing rather than informational: a build that does not
expose the contract the case declares, or whose API is non-conformant, fails
every checklist point its broken instrumentation hid. An implementation that
cannot expose the mandated contract has not met the spec. See
[load-bearing](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing).
Instrumentation decides the checklist and, through the failure caps below, the
functional rating; the aesthetic rating stays human.

## Rating channels

A run carries up to two ratings, each a five-tier scale.

- The functional rating says how faithfully the build implements the spec. It
  is rated per domain over the run's effective domain set, meaning the case's
  common [`[[domain]]`](/testing/end-to-end/manifests/)s plus any the run's
  variant declares. Each domain's rating is one tier, and the run's overall
  functional rating is the worst across its domains, so a flawless mode cannot
  mask a broken one. Its tiers, best to worst, are `flawless`, `great`,
  `passable`, `scuffed`, and `broken`.
- The aesthetic rating says how the whole build looks, sounds, and feels to
  play. It is one tier over the run, since visuals, audio, and feel are
  properties of the build rather than of any one mode. Its tiers, best to
  worst, are `legendary`, `amazing`, `good`, `okay`, and `slop`. `amazing` is
  the normal maximum, a build with nothing to fault; `legendary` is reserved
  for a build that is exceptionally beautiful, and the site marks its badge
  distinctly.

Which channel a person supplies depends on the case version. A case version is
validator-rated when it is on the engine-supported manifest format (the
`[workspaces]` / `engines` / `[[engine]]` spelling of its
[starter project](/testing/end-to-end/manifests/#the-starter-project)) and is
not a game jam. A run is validator-rated when its case version is. On a
validator-rated run the validators decide the functional rating and reviewers
supply the aesthetic rating. On a legacy run, one whose case version spells
its starter project as a single `workspace`, the reviewer's rating is the
functional rating and the run has no aesthetic rating. Legacy runs, which
include every run recorded before the engine format existed, keep behaving
exactly as they always have; the [legacy review](#legacy-review) section below
is their contract.

## The validator-decided functional rating

On a validator-rated version every graded point declares a
[`failure_cap`](/testing/end-to-end/manifests/#the-categories-grammar-format--2)
and the [`domains`](/testing/end-to-end/manifests/#the-categories-grammar-format--2)
it affects, and carries a validation script. The failure cap is the highest
functional rating the point's domains may reach while the point fails: `broken`
for a gameplay-critical requirement, otherwise `scuffed`, `passable`, or
`great`. A cap is never `flawless`, because a failure always costs something.

The rating is derived from the run record alone:

- Every effective domain starts at `flawless`.
- Each scored point whose validator failed lowers each of the point's `domains`
  to the lower of its current tier and the point's cap. A point fails when its
  validator decided `fail`, or could not run against the build for a reason
  other than an unmet precondition. A point whose validator decided nothing
  because its precondition could not be met, or that has no validator result on
  the record at all, lowers nothing.
- A point an [erratum](/testing/end-to-end/manifests/#errata) excludes from
  scoring lowers nothing, however it verdicted.
- The domain's rating is the lowest cap among its failing points, so two
  failures capped at `great` and `scuffed` leave the domain `scuffed`. A domain
  no failing point names stays `flawless`; a failure in the versus controls
  lowers only the versus domain.
- The run's overall functional rating is the worst across its domains, and the
  [toolchain gate](/components/core/validation/#the-toolchain-gate) applies on
  top of it: a build whose typecheck failed is `broken` whatever its validators
  decided.

The score is derived the same way, from the validator verdicts and the item
weights, and needs no review. Both are shown on the run the moment it completes,
and a validator-rated run may be published with no review at all. A blatantly
broken build reaches the gallery with its functional rating and score and costs
no reviewer time.

The run's Verdict tab presents the evidence in a single per-item browser, shown
to every visitor including the public gallery. Each point shows its verdict,
the failure cap (as a rating badge beside its title, in the tier's color while
the point fails and dimmed while it passes), the validator script's detail and
path and whether it ran, and the reference-vs-run media, each side of which can
be downloaded; an item rail marks each point pass or fail as the at-a-glance
overview, and a compact strip shows each effective domain's functional rating.
The figures and per-domain ratings shown are the effective ones, with any review
[overrides](#review) folded in.

## Review

The [review](/components/core/results/#reviews) is a person playing the finished
build and writing it up. On a validator-rated run it carries three things.

- A short writeup the site shows before the playable build.
- One aesthetic rating for the whole run, chosen on the `legendary`-to-`slop`
  scale. It must be supplied before the review can be submitted, and the run's
  overall aesthetic rating is the worst across its reviews.
- Optionally, checklist overrides, as follows.

Every checklist point arrives in the review form pre-filled with the verdict
the run's validators decided, marked as machine-set and shown in a
distinguishable color, and the reviewer may override any of them: a binary
pass or fail against the point's verdict id, with an optional note. A reviewer
may also decide a point the validators left undecided, such as one whose
precondition could not be met. Overriding is the exception: an unmet
precondition, or a build that clearly does the right thing despite broken
instrumentation. Points the review leaves untouched keep the validators'
verdicts, and a review naming an undeclared verdict id, or carrying a verdict
that is not binary, is refused.

A review's effective checklist is the validators' verdicts overlaid with that
review's overrides. The review carries no functional rating of its own; its
functional figures derive from its effective checklist (see
[Scoring](#scoring)), so a review with no overrides reproduces the validators'
figures exactly.

A review can be added at any time, before or after publish, so a run published
on its functional rating alone gains an aesthetic rating when someone plays it.
For how a reviewer chooses an aesthetic tier, see
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

### Legacy review

On a legacy run the review carries three things: the writeup, a functional
rating per effective domain on the `flawless`-to-`broken` scale, and a checklist
of binary verdicts, pass or fail with an optional note, one per verdict id the
case version declares for the run's variant. An item graded as a whole carries
one verdict; an item broken into
[sub-items](/testing/end-to-end/manifests/#sub-items) carries one per sub-item.
Every verdict must be recorded, and the writeup and every domain rating
supplied, before a review can be submitted, so a reviewer cannot silently skip a
requirement the author called out.

Every checklist point arrives pre-filled with the verdict the case's validator
decided, marked as machine-set and shown in a distinguishable color. The
reviewer can override any of them, and doing so is the exception: a validator
whose precondition could not be met in the world the build invented, or a build
that clearly does the right thing despite broken instrumentation.

## Scoring

A run's score is earned points over available points, like an academic test. The
score and the overall functional rating are shown together on the run, and each
test case's [leaderboard](/components/site/overview/#leaderboard) ranks the
harness and model pairs that have scored runs of the selected variant by average
score.

- An item graded as a whole is worth its declared `weight`: a `pass` earns all
  of it and a `fail` earns none.
- An item broken into sub-items is scored per sub-item. Each name-only sub-item
  is worth one point, and each review item under a
  [category](/testing/end-to-end/manifests/#the-categories-grammar-format--2) is
  worth its own `weight`, defaulting to one. The item's available points are the
  sum of its sub-items', so a build gets partial credit for a section it mostly
  gets right.
- A point an [erratum](/testing/end-to-end/manifests/#errata) excludes from
  scoring counts toward neither side of the ratio. It is still checked, driven,
  and shown.

On a validator-rated run each review's effective checklist, the validators'
verdicts overlaid with that review's [overrides](#review), produces that
review's figures. Its score counts, on both sides of the ratio, only the points
that have an effective verdict, and its functional domain ratings follow the
failure-cap rule above, with the toolchain gate on top. The run's score is the
average of its reviews' effective scores and its functional rating is the worst
across their effective ratings; while the run has no reviews, the validators'
own score and rating stand. On a legacy run each review's verdicts produce that
review's score and the run's score is the average across its reviews.

Publishing a validator-rated completed run needs no review; publishing a legacy
completed run refuses one with no review, so every published legacy
implementation is both scored and framed by a human assessment. For how a
reviewer arrives at the ratings and works the checklist, see
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).
