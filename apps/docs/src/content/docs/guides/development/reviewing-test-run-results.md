---
title: Reviewing Test Run Results
---

## Overview

The Test Cabinet evaluates a run in two stages. Automated
[validation](/components/core/validation/) catches gross failures cheaply and,
through a case's [instrumentation](/testing/end-to-end/instrumentation/), drives
the build to decide the checklist verdicts. A person's review then judges the
build's visuals, polish, and feel.

What the reviewer rates depends on the run. A
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run, one
whose case version is on the engine format, already carries a functional rating
and score decided by its validators, so the reviewer supplies the run-wide
[aesthetic rating](#rate-the-run) and may
[override](#overriding-and-restoring-an-automated-verdict) any checklist
verdict. A legacy run, one whose case version is on the `workspace` spelling,
is rated by its reviewers: the per-domain
[functional rating](#rate-a-legacy-run) and the checklist verdicts.

A review is curatorial, authored by a person after playing the build, so it sits
outside the [run record](/components/core/run-records/) contract. Every review is
attributed to the [account](/components/backend/overview/#authentication) that wrote
it, and a run may carry several reviews, one per account. Across them the run's
overall rating on the reviewer-given channel is the worst. A validator-rated run
can be [published](/guides/devops/publishing-a-test-run-result/) with no review
and gain an aesthetic rating later; a legacy run needs at least one review
before it can be published.

## Review entry points

You review a [produced](/components/core/results/#automatic-storage) run: one
whose record is stored on the backend and whose build is playable off the
[artifact service](/components/artifacts/overview/). Either path requires being
[signed in](/quickstarts/setup/register-and-login/).

- From a console. Open the run in the [web console](/components/web/overview/) or
  the [desktop app](/components/tauri/overview/) and submit a review. The console
  plays the build, shows the validation media side by side with the case's
  baselines, and writes the review file for you.
- From the CLI. `tcab review <run-id> --writeup writeup.md` submits a review
  attributed to your logged-in account. `--writeup` defaults to `writeup.md` in
  the working directory.

## Read the automated signals

The run record summarizes [validation](/components/core/validation/): the
dependency install, the static build, whether the implementation loaded in a
headless browser, and a similarity signal for each declared
[check](/components/core/validation/#checks).

Validation also decides the checklist items through the case's
[validators](/testing/end-to-end/instrumentation/), and fails any whose check
the build's
[debug API](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing)
was too broken to answer. On a validator-rated run the Verdict tab shows the
points, the functional rating and score, and a compact strip of the per-domain
functional ratings, with every per-item detail in the item browser below. The
verdicts and figures are the validators', though a reviewer may
[override](#overriding-and-restoring-an-automated-verdict) any point's verdict.
On a legacy run they arrive pre-filled as failed, and overriding one is the
exception, for a build that clearly does the right thing regardless.

What is left to you is the subjective judgement: one run-wide rating of how
the build looks, how polished it is, and how it feels to play. A run that fails
to load, or arrives with most of its checks auto-failed, is a clear negative
signal. A clean load says only that the page rendered.

## Play the build

Play the build the way a visitor would and check it against the spec: do the
mechanics match, are the screens present, are there bugs, and do any of them
affect playability.

The gallery dev server also previews runs held on disk, before anything is
published:

```sh
npm run dev -w @clockwyrks/site
```

The dev-only plugin scans `runs/` for `<id>/run-record.json` and embeds the build
under `<id>/implementation/` when a `dist/`, `build/`, or `out/` directory exists
there. Each such run shows as Unpublished. `TTC_RUNS_DIR` points the plugin at a
different directory. The plugin is serve-time only, so a production `vite build`
stays fully static and previewing publishes nothing.

## Read the checklist

A test case version declares a checklist: one observable behavior per item,
each decided by the case's validators (see the manifest's
[`review_item`s](/testing/end-to-end/manifests/)). The checklist is
reporter-side material and is never seeded into a run.

On a validator-rated run the checklist lives in the Verdict tab's item
browser, visible to every visitor, the public gallery included. Each item
shows the validator's verdict, its assertions, and the media it captured
beside the case's reference, together with the validator script's detail and
whether it ran. Every capped point names its failure cap, as a rating badge,
and the domains it affects: the badge reads in the tier's color while the
point fails and its cap is in force, and greyed out while the point passes.
Hover the badge for what a failure cap is and whether this one applies. Read
the browser to understand what the build got wrong before rating how it looks
and feels, and override a verdict only where the machine's call is wrong.

### Legacy checklist

On a legacy run the items for the run's variant appear with their point
weights, and each must be given a binary verdict before the review can be saved
or the run published:

- `pass`: the build satisfies it, earning the item's weight.
- `fail`: the build falls short of it, earning none of the weight.

Some items break into sub-items, a handful of named points each given its own
verdict. Each sub-item carries its own weight, defaulting to one point, and the
item's weight is the sum of theirs. An item with sub-items has no verdict of its
own, and every sub-item must be judged before the review is complete.

Add a short note alongside a verdict to record what you observed. The verdicts
and weights produce the run's score: the earned weight over the total declared
weight. An erratum may retire a point from scoring entirely; see
[Authoring Errata](/guides/devops/authoring-errata/).

### Overriding and restoring an automated verdict

A point validation answered arrives already filled in the review editor, shown
**desaturated** to mark it as the machine's call rather than yours. Click it to
override; the option fills in full color to show the verdict is now yours.
Overriding is the exception, for a validator whose precondition could not be
met, or a build that clearly does the right thing despite broken
instrumentation.

On a validator-rated run every point arrives this way, and a reviewer may also
decide a point the validators left undecided. Overrides need not be complete:
a point left untouched keeps the validators' verdict and is not part of the
review. The review's effective checklist is the validators' verdicts overlaid
with its overrides, and from it come that review's score and per-domain
functional ratings under the same failure-cap rule. The run's score is the
average of its reviews' effective scores and its functional rating the worst
of their effective ratings; while the run has no reviews the validators' own
figures stand.

An override is undoable at any time, including in a later edit of an
already-submitted review: an overridden point grows a **Restore** control beside its
note, and the checklist rail offers **Restore validator verdicts** to put every
overridden point back at once. Both restore only the pass/fail — validation writes
no notes, so yours are kept, and yours to clear. The controls appear only where your
answer actually differs from a verdict validation decided; a subjective point, or one
whose check could not run, has no machine value to restore and is never touched.

This works however many edits later because the machine's verdicts live in the
run record, which never changes, rather than in the review — a stored verdict itself
keeps no memory of having been auto-set.

## Write the review

A review file is Markdown with YAML frontmatter carrying the ratings and a
non-empty body. On a validator-rated run the frontmatter carries one bare
`aesthetic:` line rating the whole run, plus a `review.<id>: <status> [note]`
line for each verdict the review overrides. An override names a declared
verdict id (a sub-item uses the composite `<item id>.<sub-item id>`) with a
binary `pass` or `fail` status:

```markdown
---
aesthetic: good
review.obstacle-bank: pass the validator's precondition never armed the bank
---

Clean pixel art and a satisfying paddle thunk. The versus screen reuses the solo
layout without adjusting for two players, so it feels cramped.
```

Legacy per-domain `aesthetic.<domain>:` lines still parse and collapse to the
worst tier named.

On a legacy run each domain's functional rating is a `rating.<domain>:` line.
Checklist verdicts follow as `review.<id>: <status> [note]` lines, and a
sub-item's verdict uses the composite id
`review.<item id>.<sub-item id>: <status> [note]`:

```markdown
---
rating.single-player: flawless
rating.versus: scuffed
review.ball-spin.stationary: pass
review.ball-spin.moving: pass
review.obstacle-bank: fail ball clips the top obstacle corner
---

Single player feels right. Versus has a serve bug that resets the score, so it's
playable but scuffed.
```

The consoles write this file for you. The format is documented here because the
file is also hand-editable, and because the CLI paths read it from disk:
`tcab review` reads `writeup.md` (or the `--writeup` path), and `tcab publish`
reads `<run-id>.md` from the working directory.

A review of a validator-rated run is rejected while the aesthetic tier is
missing, and if it carries a `rating.*` line, since the functional rating is
the validators' to give. A legacy run cannot be published while any declared
domain is unrated or any declared checklist item or sub-item is missing its
verdict.

## Rate the run

The writeup is the short prose the site shows before the playable build. The
ratings travel with it in the frontmatter.

On a validator-rated run you rate aesthetics once for the whole run: how the
build looks, sounds, and feels to play, judged as a game rather than against
the spec, since the validators have already decided how faithfully the spec
was met. Choose one of five tiers:

- `legendary`: exceptionally beautiful. Reserved for a build whose look and
  feel stand out from every other run of the case; most amazing builds are not
  legendary.
- `amazing`: the normal maximum. Flawless presentation with nothing to fault.
- `good`: looks and plays well, with minor rough edges that leave the
  experience intact.
- `okay`: passable presentation. Functional and coherent, with rough edges a
  player notices.
- `slop`: scuffed or broken presentation. Placeholder art, jarring motion or
  audio, or a look that gets in the way of playing.

The run's overall aesthetic rating is the worst across its reviews.

### Rate a legacy run

On a legacy run you rate function, how faithfully each
[domain](/terminology/#domain) implements the spec. Rate each domain in the
run variant's effective set independently, the case's common domains plus any
the run's variant declares, choosing one of five tiers:

- `flawless`: implemented to spec with no noticeable bugs.
- `great`: to spec, with minor issues that leave playability intact.
- `passable`: to spec and playable, with rough edges beyond a great run's minor
  issues, though still within the spec and playable.
- `scuffed`: mostly to spec. Playable, though it may deviate from the spec or
  carry bugs that impact playability.
- `broken`: deviates from the spec, or carries bugs severe enough to render the
  game unplayable.

The run's overall functional rating is the worst across its domains, so a
flawless mode cannot mask a broken one.

## Game jam grading

A [game jam](/testing/game-jam/overview/) declares no scoring domains. Its review
items are graded on a five-level scale, and the reviewer supplies a whole-game
grade directly under the reserved `overall` verdict id. That grade becomes the
run's rating badge in place of a domain rating, and the run's overall grade is
the worst across its reviews.

| Grade        | Points |
| ------------ | ------ |
| `broken`     | 0      |
| `poor`       | 1      |
| `neutral`    | 3      |
| `great`      | 5      |
| `incredible` | 10     |

A graded item's available points are its weight times 10, and it earns the graded
tier's points times its weight. The reserved `overall` mark is excluded from the
point score.

## Next step

A validator-rated run is ready to
[publish](/guides/devops/publishing-a-test-run-result/) as soon as it completes;
a legacy run is ready once it has at least one review. If you reviewed a run
someone else produced, an operator can now publish it. If you ran, reviewed, and
are publishing it yourself, `tcab publish` does the self-review and publish in
one step.
