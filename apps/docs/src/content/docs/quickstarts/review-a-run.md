---
title: Review a Run
---

Every published run carries a hand-written [review](/components/core/results/#reviews)
— a writeup and a rating, authored after playing the build. Publishing refuses a
run without one. The full workflow is in
[Reviewing Test Run Results](/guides/reviewing-test-run-results/).

## Preview the build

Run the gallery dev server; it scans `runs/` and invokes each run's local build
where one exists:

```sh
npm run dev -w @test-cabinet/site
```

Play the finished build the way a visitor would before judging it.

## Write the review

Create `runs/<id>/writeup.md` beside the run's `run-record.json`, with the rating
in YAML frontmatter:

```markdown
---
rating: great
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

The body must not be empty. The rating is a per-run signal, never aggregated or
ranked. With the dev server running, the rating badge and writeup preview exactly
as they will once live.

## Next step

[Publish a Run](/quickstarts/publish-a-run/) once the review is in place.
