---
title: Review a Run
---

## Overview

A produced run is reviewed before it is published. A review is a writeup, a
rating for each of the case's scoring domains, and a verdict on each
reviewer-checklist item, authored after playing the build. Verdicts and the
items' point weights produce the review's score; across a run's reviews the score
is averaged and the overall rating is the worst.

Every review is attributed to the account that wrote it, a run carries one review
per account, and publishing requires at least one review. The full workflow is
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

## Review in a console

The [desktop app](/components/tauri/overview/) and the
[web console](/components/web/overview/) are the primary way to review.
[Sign in](/quickstarts/setup/register-and-login/), open the finished run, play
its build, and fill in the review editor:

- Work the reviewer checklist. Items are presented one at a time, with a rail of
  every item alongside and answered ones marked done. Each item shows its point
  weight and takes a pass or fail verdict plus an optional note. When the item
  declares them, the case's expected reference is shown beside the agent's
  submitted [proof](/components/core/validation/#proofs).
- Rate each scoring domain and write the prose writeup. Saving the review and
  publishing the run both require every item answered and every domain rated.

The web console submits the review and publishes as two actions; the desktop app
offers a single action that does both. A run's Proof tab lists every proof the
build submitted, browsable independent of the checklist.

## Edit a review

Re-submitting from the same account updates that account's review in place. Use
Edit review on your own review to revise a verdict, a rating, or the writeup.

A verdict [automated validation](/components/core/validation/) decided is
recoverable in an edit: a point whose answer differs from the machine's carries a
Restore control, and the checklist rail's Restore validator verdicts puts every
overridden point back at once, keeping the notes. See
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
with YAML frontmatter carrying a `rating.<domain>` line per scoring domain and a
`review.<id>` line per checklist verdict, followed by the prose body. A
sub-itemed checklist item takes one `review.<item>.<sub>` line per sub-item, and
the first word of a verdict is its status with any remainder kept as the note:

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

Each domain rating is one of:

- `flawless`: to spec, no noticeable bugs.
- `great`: to spec, with minor issues that leave playability intact.
- `passable`: to spec and playable, with rough edges beyond a great run's minor
  issues.
- `scuffed`: mostly to spec. Playable, though noticeably deviating from spec or
  carrying bugs that affect play.
- `broken`: deviates from the spec, or is unplayable.

The body must carry prose. A run is publishable once every declared domain is
rated and every declared checklist item and sub-item has a verdict.

A [game jam](/testing/game-jam/overview/) run rates no domains: its checklist
verdicts use the graded tiers `broken`, `poor`, `neutral`, `great`, and
`incredible`, including the reserved `overall` item that becomes the run's
rating.

## Next step

[Publish a Run](/quickstarts/devops/publish-a-run/) once the review is in place.
