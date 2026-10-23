---
title: "Demonstrations"
---

A demonstration is a short, self-contained project that shows one game mechanic
in practice. Demonstrations ship with the suite as suite content, and they are
how a user is told what a mechanic is expected to look like when it works.

Each demonstration is a Vite project that builds to a static bundle. The bundle
is embedded in The Spec Cabinet's UI and in The Test Cabinet's UI the same way a
run's produced implementation is played there, so a demonstration is exercised
in the browser rather than read.

## Layout

Demonstrations live under `demos/` in the suite tree, one folder per
demonstration:

```text
demos/
  shared/
  ball-bounce/
    demo.toml
    index.html
    src/
```

`demos/shared/` is a TypeScript library the demonstrations depend on. Logic that
more than one demonstration needs is written there exactly once.

## `demo.toml`

Each demonstration declares its identity and what it demonstrates:

```toml
# demos/<slug>/demo.toml
id = "ball-bounce"              # stable identity (required); matches the directory
name = "Ball Bounce"            # human-readable display name (required)
summary = "One short line."     # one-line abstract (required, inline plain text)
specification = "ball-physics"  # the specification whose mechanic this demonstrates
```

`specification` is the `id` of a specification declared by the suite, which is
what binds a demonstration to the mechanic it illustrates.

## Scope

A demonstration implements only what its mechanic needs, which makes it a
different artifact from a
[reference implementation](/test-suites/reference-implementations/).
