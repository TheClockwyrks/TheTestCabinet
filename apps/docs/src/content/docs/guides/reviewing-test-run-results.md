---
title: Reviewing Test Run Results
---

The Test Cabinet's real evaluation is a person playing the produced
implementation and judging how well it matches the spec — automation only catches
gross failures cheaply (see the [home page](/) and
[Review](/terminology/#review) terminology). That judgement is what produces a
run's numbers: a per-[domain](/terminology/#domain) **rating** and a numeric
**[score](/terminology/#score)** in points. This guide covers assessing a
finished run: reading its automated signals, playing the build, and writing a
**review**.

A review is **curatorial** — authored separately by a person after playing the
build, not emitted by the run — and it is deliberately not part of the
[run record](/components/core/run-records/) contract. Every review is attributed
to the [account](/components/backend/overview/#accounts) that wrote it, and a run
may carry **several reviews, one per account** — typically from people other than
the operator who produced the run. Across them, the
run's score is the **average** and its overall rating the **worst**. A run needs at
least one review before it can be [published](/guides/publishing-a-test-run-result/),
so review is the gate between producing a run and putting it on the gallery.

You review a [produced](/components/core/results/#stored-when-produced) run — one
whose build is playable off the artifact service. From a console, open the run and
submit a review; from
the CLI, `tcab review <run-record> --writeup writeup.md` submits one attributed to
your logged-in account. Either way you must be
[signed in](/quickstarts/register-and-login/).

## What a finished run leaves on disk

A completed run writes `runs/<id>/run-record.json` alongside a copy of the
produced implementation. The record summarizes
[validation](/components/core/validation/): the dependency install, the static
build, whether the implementation **loaded** in a headless browser, and a
similarity signal for each declared [check](/components/core/validation/#checks).

Treat these as signals, not the score. Validation exists to catch gross failures
cheaply and to compare a few deterministic views against their baselines; it is
**not** a pass/fail gate and it does not produce the run's score — that comes from
the review you write. A run that fails to load is the clearest possible negative
signal, but a clean load says only that the page rendered — the assessment is
still yours to make by playing it.

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

Add a short note alongside a verdict to record what you observed. The verdicts and
the items' weights produce the run's **score** — the earned weight over the total
declared weight. The per-domain ratings below remain your own call.

## Write the review

Create `runs/<id>/writeup.md`, beside the run's `run-record.json`, with a rating
for each scoring domain in YAML frontmatter and a non-empty body. Each domain's
rating is a `rating.<domain>:` line; checklist verdicts, when the case declares
items, follow as `review.<id>: <status> [note]` lines:

```markdown
---
rating.single-player: flawless
rating.versus: scuffed
review.ball-spin: pass
review.obstacle-bank: fail ball clips the top obstacle corner
---

Single player feels right. Versus has a serve bug that resets the score, so it's
playable but scuffed.
```

The consoles write this file for you, including the rating and checklist lines;
the format is documented here because the file is also hand-editable. A run
cannot be published while any declared domain is unrated or any declared
checklist item is missing its verdict.

The **writeup** is the short prose the site shows before the playable build. The
**ratings** travel with it in the frontmatter (not in the run record). You rate
each [domain](/terminology/#domain) in the run variant's **effective** set — the
case's common domains plus any the run's variant declares in its own file —
independently, choosing one of four hand-assigned tiers per domain:

- **flawless** — implemented to spec with no noticeable bugs.
- **great** — to spec; may have minor issues so long as they don't impact
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
[publish](/guides/publishing-a-test-run-result/). If you reviewed a run someone
else pushed, an operator can now publish it; if you ran, reviewed, and are
publishing it yourself, `tcab publish` does the push, self-review, and publish in
one step.
