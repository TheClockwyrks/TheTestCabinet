---
title: Reviewing Test Run Results
---

The Test Cabinet evaluates a run in two stages. Automated
[validation](/components/core/validation/) catches gross failures cheaply and,
through a case's [instrumentation](/testing/end-to-end/instrumentation/), drives
the build to decide the objective, mechanically-checkable requirements. A
person's **review** then makes the judgement automation cannot: how well the
build *plays* and matches the spec's intent (see the [home page](/) and
[Review](/terminology/#review) terminology). That human judgement is what produces
a run's subjective numbers: a per-[domain](/terminology/#domain) **rating** and
the checklist verdicts automation does not decide. This guide covers assessing a
finished run: reading its automated signals, playing the build, and writing a
**review**.

A review is **curatorial** — authored separately by a person after playing the
build, not emitted by the run — and it is deliberately not part of the
[run record](/components/core/run-records/) contract. Every review is attributed
to the [account](/components/backend/overview/#accounts) that wrote it, and a run
may carry **several reviews, one per account** — typically from people other than
the operator who produced the run. Across them, the
run's score is the **average** and its overall rating the **worst**. A run needs at
least one review before it can be [published](/guides/devops/publishing-a-test-run-result/),
so review is the gate between producing a run and putting it on the gallery.

You review a [produced](/components/core/results/#stored-when-produced) run — one
whose build is playable off the artifact service. From a console, open the run and
submit a review; from
the CLI, `tcab review <run-record> --writeup writeup.md` submits one attributed to
your logged-in account. Either way you must be
[signed in](/quickstarts/setup/register-and-login/).

## What a finished run leaves on disk

A completed run writes `runs/<id>/run-record.json` alongside a copy of the
produced implementation. The record summarizes
[validation](/components/core/validation/): the dependency install, the static
build, whether the implementation **loaded** in a headless browser, and a
similarity signal for each declared [check](/components/core/validation/#checks).

Validation catches gross failures cheaply, compares a few deterministic views
against their baselines, and — through the case's
[instrumentation](/testing/end-to-end/instrumentation/) — decides the objective,
mechanically-checkable checklist items, automatically failing any whose check the
build's
[debug API](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing)
was too broken to answer (those arrive pre-filled as failed, and you can override
one where the build clearly does the right thing regardless). What is left to you
is the **subjective** judgement automation cannot make honestly: the per-domain
ratings and the verdicts that turn on how the build actually plays. A run that
fails to load — or arrives with most of its checks auto-failed — is a clear
negative signal; a clean load says only that the page rendered, and the feel of
the game is still yours to assess by playing it.

## Play the build

Preview the implementation exactly as it will appear once published, before
judging it. With the gallery dev server running, a dev-only plugin scans `runs/`
and plays each run's local build where one exists (e.g. from validation):

```sh
npm run dev -w @test-cabinet/site
```

Each run shows as **Unpublished**, and where its `dist/`, `build/`, or `out/`
directory exists the detail page embeds and plays that local build directly — no
hosting required. Point the plugin at a different directory with
`TTC_RUNS_DIR=/path/to/runs`. This is a dev convenience only: the plugin is
serve-time, so a production `vite build` stays fully static, and previewing never
publishes anything.

Play the build the way a visitor would and check it against the spec: do the
mechanics match, are the screens present, are there bugs, and do any of them
affect playability.

## Work the checklist

A test case version may declare a **reviewer checklist** — a list of items the
case author marked as things every reviewer must explicitly check (see the
manifest's [`review_item`s](/testing/end-to-end/manifests/)). The checklist
is the case's guarantee that the major requirements are verified by hand rather
than left to whatever a reviewer happens to notice; it is **not** seeded into the
run, so it never reaches the model.

In the [desktop app](/components/tauri/overview/) and the
[web console](/components/web/overview/) the items for the run's variant appear
in the review editor — each showing its point **weight** — and each must be given
a binary verdict before the review can be saved or the run published:

- **pass** — checked, and the build satisfies it. Earns the item's weight.
- **fail** — checked, and the build does not satisfy it. Earns none of it.

Some items break into **sub-items** — a handful of named points, each with its own
pass/fail — so a section can be graded on more than one axis. You verdict each
sub-item (there is no separate verdict for the item as a whole); the item's weight
splits evenly across them, so it earns partial credit — `weight × (passed ÷ total)`
sub-items. Every sub-item must be judged before the review is complete.

Add a short note alongside a verdict to record what you observed. The verdicts and
the items' weights produce the run's **score** — the earned weight over the total
declared weight. The per-domain ratings below remain your own call.

### Overriding and restoring an automated verdict

A point the case [instruments](/testing/end-to-end/instrumentation/) arrives
already answered by validation, shown **desaturated** to mark it as the machine's
call rather than yours. Click it to override where the build clearly does the right
thing regardless; the option fills in full color to show the verdict is now yours.

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

Create `runs/<id>/writeup.md`, beside the run's `run-record.json`, with a rating
for each scoring domain in YAML frontmatter and a non-empty body. Each domain's
rating is a `rating.<domain>:` line; checklist verdicts, when the case declares
items, follow as `review.<id>: <status> [note]` lines. A sub-item's verdict uses
the composite id `review.<item id>.<sub-item id>: <status> [note]`:

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

The consoles write this file for you, including the rating and checklist lines;
the format is documented here because the file is also hand-editable. A run
cannot be published while any declared domain is unrated or any declared
checklist item — or sub-item — is missing its verdict.

The **writeup** is the short prose the site shows before the playable build. The
**ratings** travel with it in the frontmatter (not in the run record). You rate
each [domain](/terminology/#domain) in the run variant's **effective** set — the
case's common domains plus any the run's variant declares in its own file —
independently, choosing one of five hand-assigned tiers per domain:

- **flawless** — implemented to spec with no noticeable bugs.
- **great** — to spec; may have minor issues so long as they don't impact
  playability.
- **passable** — to spec and playable, but with rough edges beyond a great run's
  minor issues; noticeable, though not enough to deviate from the spec or impair
  playability.
- **scuffed** — mostly to spec. Playable, but may deviate from the spec or have
  bugs that impact playability.
- **broken** — doesn't follow the spec, or has bugs severe enough to render the
  game unplayable.

The run's **overall rating** is the *worst* across its domains, so a flawless
mode cannot mask a broken one. With the dev server still running, the overall
rating badge, the score, and the writeup preview on the run's page exactly as
they will once live, so you can confirm the framing before publishing.

## Next step

Once a run has at least one review, it is ready to
[publish](/guides/devops/publishing-a-test-run-result/). If you reviewed a run someone
else pushed, an operator can now publish it; if you ran, reviewed, and are
publishing it yourself, `tcab publish` does the push, self-review, and publish in
one step.
