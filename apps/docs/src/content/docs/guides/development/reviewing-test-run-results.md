---
title: Reviewing Test Run Results
---

## Overview

The Test Cabinet evaluates a run in two stages. Automated
[validation](/components/core/validation/) catches gross failures cheaply and,
through a case's [instrumentation](/testing/end-to-end/instrumentation/), drives
the build to decide the objective, mechanically-checkable requirements. A
person's review then judges how well the build plays and matches the spec's
intent, producing the per-[domain](/terminology/#domain) rating and the checklist
verdicts automation does not decide.

A review is curatorial, authored by a person after playing the build, so it sits
outside the [run record](/components/core/run-records/) contract. Every review is
attributed to the [account](/components/backend/overview/#authentication) that wrote
it, and a run may carry several reviews, one per account. Across them the run's
score is the average and its overall rating the worst. A run needs at least one
review before it can be
[published](/guides/devops/publishing-a-test-run-result/).

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

Validation also decides the objective checklist items a case marks as
[automatically validated](/testing/end-to-end/instrumentation/), and fails any
whose check the build's
[debug API](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing)
was too broken to answer. Those arrive pre-filled as failed. Override one where
the build clearly does the right thing regardless.

What is left to you is the subjective judgement: the per-domain ratings and the
verdicts that turn on how the build plays. A run that fails to load, or arrives
with most of its checks auto-failed, is a clear negative signal. A clean load
says only that the page rendered.

## Play the build

Play the build the way a visitor would and check it against the spec: do the
mechanics match, are the screens present, are there bugs, and do any of them
affect playability.

The gallery dev server also previews runs held on disk, before anything is
published:

```sh
npm run dev -w @test-cabinet/site
```

The dev-only plugin scans `runs/` for `<id>/run-record.json` and embeds the build
under `<id>/implementation/` when a `dist/`, `build/`, or `out/` directory exists
there. Each such run shows as Unpublished. `TTC_RUNS_DIR` points the plugin at a
different directory. The plugin is serve-time only, so a production `vite build`
stays fully static and previewing publishes nothing.

## Work the checklist

A test case version may declare a reviewer checklist: items the case author
marked as things every reviewer must explicitly check (see the manifest's
[`review_item`s](/testing/end-to-end/manifests/)). The checklist is
reporter-side material and is never seeded into a run.

In the review editor the items for the run's variant appear with their point
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

## Write the review

A review file is Markdown with YAML frontmatter: a rating for each scoring domain
and a non-empty body. Each domain's rating is a `rating.<domain>:` line.
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

A run cannot be published while any declared domain is unrated or any declared
checklist item or sub-item is missing its verdict.

## Rate each domain

The writeup is the short prose the site shows before the playable build. The
ratings travel with it in the frontmatter. Rate each
[domain](/terminology/#domain) in the run variant's effective set independently,
choosing one of five tiers. The effective set is the case's common domains plus
any the run's variant declares.

- `flawless`: implemented to spec with no noticeable bugs.
- `great`: to spec, with minor issues that leave playability intact.
- `passable`: to spec and playable, with rough edges beyond a great run's minor
  issues, though still within the spec and playable.
- `scuffed`: mostly to spec. Playable, though it may deviate from the spec or
  carry bugs that impact playability.
- `broken`: deviates from the spec, or carries bugs severe enough to render the
  game unplayable.

The run's overall rating is the worst across its domains, so a flawless mode
cannot mask a broken one.

## Game jam grading

A [game jam](/testing/game-jam/overview/) declares no scoring domains. Its review
items are graded on a five-level scale, and the reviewer supplies a whole-game
grade directly under the reserved `overall` verdict id. That grade becomes the
run's rating badge in place of a domain rating, and the run's overall grade is
the worst across its reviews.

| Grade | Points |
| --- | --- |
| `broken` | 0 |
| `poor` | 1 |
| `neutral` | 3 |
| `great` | 5 |
| `incredible` | 10 |

A graded item's available points are its weight times 10, and it earns the graded
tier's points times its weight. The reserved `overall` mark is excluded from the
point score.

## Next step

Once a run has at least one review it is ready to
[publish](/guides/devops/publishing-a-test-run-result/). If you reviewed a run
someone else produced, an operator can now publish it. If you ran, reviewed, and
are publishing it yourself, `tcab publish` does the self-review and publish in
one step.
