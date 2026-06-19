---
title: Review a Run
---

Every published run carries a hand-written [review](/components/core/results/#reviews)
— a writeup and a rating, plus a verdict on each of the case's
[reviewer-checklist](/components/core/test-cases/#manifest) items — authored after
playing the build. Publishing refuses a run without one. The full workflow is in
[Reviewing Test Run Results](/guides/reviewing-test-run-results/).

## Review in a console

The [Tauri desktop app](/components/tauri/overview/) and the
[web console](/components/web/overview/) are the primary way to review. Open the
finished run, play its build, then fill in the review editor:

- Work the **reviewer checklist** — each item the case declared gets a verdict
  (**pass** / **fail** / **na**), optionally with a note. The console will not let
  you save the review or publish the run until every item has a verdict (the
  **completeness gate**).
- Pick the **rating** and write the prose **writeup**.

The console writes the review to `runs/<id>/writeup.md` for you.

## Review by hand

The review file is also hand-editable. Create `runs/<id>/writeup.md` beside the
run's `run-record.json`, with the rating in YAML frontmatter and any checklist
verdicts as `review.<id>: <status> [note]` lines:

```markdown
---
rating: great
review.ball-spin: pass
review.obstacle-bank: fail ball clips the top obstacle corner
---

Movement and collision feel right. The pause menu doesn't restore keyboard
focus, but it doesn't block play.
```

The rating must be one of:

- **flawless** — to spec, no noticeable bugs.
- **great** — to spec; minor issues that don't impact playability.
- **scuffed** — mostly to spec; playable but noticeably deviates from spec or
  has bugs that affect play.
- **broken** — doesn't follow the spec, or is unplayable.

The body must not be empty, and a run cannot be published while any declared
checklist item is missing its verdict. The rating is a per-run signal, never
aggregated or ranked.

## Preview the build

To preview an unpublished run the way a visitor will — outside a console — run
the gallery dev server; it scans `runs/` and plays each run's local build where
one exists:

```sh
npm run dev -w @test-cabinet/site
```

The rating badge and writeup preview exactly as they will once live.

## Next step

[Publish a Run](/quickstarts/publish-a-run/) once the review is in place.
