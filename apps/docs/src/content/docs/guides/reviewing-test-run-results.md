---
title: Reviewing Test Run Results
---

The Test Cabinet does not reduce a run to a single number. Its real evaluation is
a person playing the produced implementation and judging how well it matches the
spec (see the [home page](/) and [Review](/terminology/#review) terminology).
This guide covers assessing a finished run: reading its automated signals,
playing the build, and writing the **review** that publishing requires.

A review is **curatorial** — authored separately by a person after playing the
build, not emitted by the run — and it is deliberately not part of the
[run record](/components/core/run-records/) contract. It is also a hard
prerequisite: [publishing](/guides/publishing-a-test-run-result/) refuses any run
without one.

## What a finished run leaves on disk

A completed run writes `runs/<id>/run-record.json` alongside a copy of the
produced implementation. The record summarizes
[validation](/components/core/validation/): the dependency install, the static
build, whether the implementation **loaded** in a headless browser, and a
similarity signal for each declared [check](/components/core/validation/#checks).

Treat these as signals, not a grade. Validation exists to catch gross failures
cheaply and to compare a few deterministic views against their baselines; it is
**not** a pass/fail gate and it does not rank runs. A run that fails to load is
the clearest possible negative signal, but a clean load says only that the page
rendered — the assessment is still yours to make by playing it.

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

## Write the review

Create `runs/<id>/writeup.md`, beside the run's `run-record.json`, with the
rating in YAML frontmatter and a non-empty body:

```markdown
---
rating: great
---

Movement and collision feel right. The pause menu doesn't restore keyboard
focus, but it doesn't block play.
```

The **writeup** is the short prose the site shows before the playable build. The
**rating** travels with it in the frontmatter (not in the run record) and must be
exactly one of four hand-assigned tiers:

- **flawless** — implemented to spec with no noticeable bugs.
- **great** — to spec; may have minor issues so long as they don't impact
  playability.
- **scuffed** — mostly to spec. Playable, but may deviate from the spec or have
  bugs that impact playability.
- **broken** — doesn't follow the spec, or has bugs severe enough to render the
  game unplayable.

The rating is a subjective, per-run signal shown alongside the run; it is never
aggregated or used to rank runs. With the dev server still running, the rating
badge and writeup preview on the run's page exactly as they will once live, so
you can confirm the framing before publishing.

## Next step

Once the review is in place, the run is ready to
[publish](/guides/publishing-a-test-run-result/).
