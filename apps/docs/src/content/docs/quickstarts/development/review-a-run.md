---
title: Review a Run
---

## Overview

A review is a writeup and a rating, authored after playing the build. On a
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
validators have decided the checklist, the functional rating, and the score,
so the review rates the run's aesthetics with a single tier and may override
individual checklist verdicts, which recomputes that review's score and
functional rating. On a legacy run the review rates function per scoring
domain and adds a verdict on each reviewer-checklist item; those verdicts and
the items' point weights produce the review's score. Either way a run's score
averages across its reviews and its rating is the worst across them; a
validator-rated run with no reviews keeps the validators' own figures.

Every review is attributed to the account that wrote it and a run carries one
review per account. Publishing a legacy run requires at least one review; a
validator-rated run can be reviewed before or after it is published. The full
workflow is
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

## Review in the web console

The [web console](/components/web/overview/) is the primary way to review.
[Sign in](/quickstarts/setup/register-and-login/), open the finished run, play
its build, and fill in the review editor:

- Read the checklist. Items are presented one at a time, with a rail of every
  item alongside. On a validator-rated run each item arrives pre-filled with
  the validator's verdict, shown desaturated until you override it, alongside
  its assertions and media; untouched items keep the validators' verdicts. On
  a legacy run each item shows its point weight and takes a pass or fail
  verdict plus an optional note, and answered ones are marked done. When the
  item declares them, the case's expected reference is shown beside the
  agent's submitted [proof](/components/core/validation/#proofs).
- Rate the run: one aesthetic tier for the whole build on a validator-rated
  run, or each scoring domain on the functional scale on a legacy run, and
  write the prose writeup. Saving the review requires the rating, and on a
  legacy run every domain rated and every item answered.

The web console submits the review and publishes as two separate actions. A
run's Proof tab lists every proof the build submitted, browsable independent of
the checklist.

## Edit a review

Re-submitting from the same account updates that account's review in place. Use
Edit review on your own review to revise a verdict, a rating, or the writeup.

A verdict [automated validation](/components/core/validation/) decided is
recoverable in an edit: a point whose answer differs from the machine's
carries a Restore control, and the checklist rail's Restore validator verdicts
puts every overridden point back at once, keeping the notes. See
[overriding and restoring an automated verdict](/guides/development/reviewing-test-run-results/#overriding-and-restoring-an-automated-verdict).

An edit that changes something requires a short note explaining what changed.
Each edit is kept as a revision in the review's public edit history alongside a
generated diff of the ratings, verdicts, and writeup. The review keeps its first
submission time and records an edited marker for the latest revision.

## Review from the CLI

From a [signed-in](/quickstarts/setup/register-and-login/) shell, submit a review
for a stored run by its backend run id:

```sh
tcab review <run-id> --writeup writeup.md
```

`--writeup` defaults to `writeup.md` in the working directory. The file opens
with YAML frontmatter followed by the prose body. For a validator-rated run
the frontmatter carries one bare `aesthetic` line rating the whole run, plus
an optional `review.<id>` line per verdict override, with a binary `pass` or
`fail` status and any remainder kept as the note:

```markdown
---
aesthetic: good
review.obstacle-bank: pass the validator's precondition never armed the bank
---

Clean pixel art and a satisfying paddle thunk. The versus screen reuses the solo
layout without adjusting for two players, so it feels cramped.
```

Legacy per-domain `aesthetic.<domain>` lines still parse and collapse to the
worst tier named. The review is rejected while the aesthetic tier is missing
or a `rating.*` line is present. The aesthetic rating is one of:

- `legendary`: exceptionally beautiful; reserved for a build that stands out
  from every other run of the case.
- `amazing`: the normal maximum, flawless presentation.
- `good`: looks and plays well with minor rough edges.
- `okay`: passable presentation with rough edges a player notices.
- `slop`: scuffed or broken presentation.

For a legacy run the frontmatter carries a `rating.<domain>` line per scoring
domain and a `review.<id>` line per checklist verdict. A sub-itemed checklist
item takes one `review.<item>.<sub>` line per sub-item, and the first word of a
verdict is its status with any remainder kept as the note:

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

Each functional rating is one of:

- `flawless`: to spec, no noticeable bugs.
- `great`: to spec, with minor issues that leave playability intact.
- `passable`: to spec and playable, with rough edges beyond a great run's minor
  issues.
- `scuffed`: mostly to spec. Playable, though noticeably deviating from spec or
  carrying bugs that affect play.
- `broken`: deviates from the spec, or is unplayable.

The body must carry prose. A legacy run is publishable once every declared
domain is rated and every declared checklist item and sub-item has a verdict.

A [game jam](/testing/game-jam/overview/) run rates no domains: its checklist
verdicts use the graded tiers `broken`, `poor`, `neutral`, `great`, and
`incredible`, including the reserved `overall` item that becomes the run's
rating.

## Next step

[Publish a Run](/quickstarts/devops/publish-a-run/) once the review is in place,
or straight away for a validator-rated run.
