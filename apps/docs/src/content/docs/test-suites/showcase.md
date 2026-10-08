---
title: "Showcase"
---

A test suite's showcase configuration and files provide the data needed by The
Test Cabinet to display the test suite. The Test Cabinet renders the showcase as
the test suite's landing page. The Spec Cabinet renders it alongside the suite's
other editable entities.

The suite showcase takes the same on-disk format as the run and case showcases,
including the extension-to-kind mapping and the shared caps on the description,
the carousel, and each media file. See
[Showcases](/components/core/showcase/) for that table and those bounds.

## The showcase directory

The showcase is the `showcase/` directory of the suite tree. It
holds three things:

- `showcase.md`, the description.
- `showcase.toml`, the carousel.
- The media files the two of them reference.

```text
carom/versions/v1.0.0/showcase/
  showcase.md
  showcase.toml
  title.png
  volley.png
```

## showcase.md

`showcase.md` is player-facing prose written in the style of a store page. It
describes the project to someone deciding whether it looks interesting.

The description references media files sitting in the same directory by bare
relative path, such as `![Opening volley](volley.png)`. A reference resolves
against the showcase directory alone.

## showcase.toml

`showcase.toml` declares the carousel as repeated `[[media]]` tables. Table
order is carousel order.

```toml
[[media]]
file = "title.png"              # required, a file in the showcase directory
name = "Title screen"           # required, short caption

[[media]]
file = "volley.png"
name = "Opening volley"
```

### Media keys

- `file`: the name of a file in the showcase directory. The value is a plain
  file name, so it carries no path separators.
- `name`: a short caption displayed with the entry.

## Media files

Media files sit beside `showcase.md` and `showcase.toml` in the showcase
directory itself. A file may be listed by the carousel, referenced by the
description, or both. The suite's media is captured from its
[reference implementations](/test-suites/reference-implementations/), so it
shows the suite as it is intended to be implemented.
