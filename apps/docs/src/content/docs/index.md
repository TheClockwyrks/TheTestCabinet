---
title: The Test Cabinet
---

The Test Cabinet is an evaluation suite for AI models and harnesses. Rather than
a purely automated benchmark, it relies on a reviewer running the final
implementation and comparing it against the specs. Each run is then assigned a
numeric **score** — the points its checklist earned out of the points available —
and a quality **rating** for each of the case's scoring domains, so a flawless
mode can't mask a broken one. Each test case has a per-variant **leaderboard**
ranking models by score.

Test cases used by The Test Cabinet are very different from existing benchmarks
like SWE Bench Pro. The Test Cabinet's tests do not attempt to be small-scale;
if anything, these test cases are intentionally *not* small scale. The purpose
of the tests is not to answer "How well can a model complete a small task in a
codebase?", but rather "How well can a model handle a large, complex task and
take it to completion autonomously?".

## Audience

This documentation is intended for developers working on The Test Cabinet itself
and for any end users who would like to run The Test Cabinet locally. Test cases
can be driven from the command line with the [CLI](/components/cli/overview/),
interactively in the [Tauri desktop app](/components/tauri/overview/), or on a
server via a per-run [driver](/components/driver/overview/) `Job` from the
[web console](/components/web/overview/). Developers will want to primarily refer
to the [Components](/components/architecture/) section, while end users should
focus their attention on the [Quickstarts](/quickstarts/overview/) and
[User Guides](/guides/overview/) sections. New users should start with
[First Time Setup](/guides/setup/first-time-setup/).

## AI-Generated Documentation

Documentation for The Test Cabinet is typically AI-generated initially. This is
done to establish intent and lock in design decisions before writing code, after
which the implementation is created using the documentation as a reference.

Once an implementation has been written and adjusted as needed, a second, manual
pass is done over the documentation. This means that there will be a mix of
developer-authored and AI-authored documentation present. Expect to see a mix of
em dashes and regular hyphens depending on who authored the documentation and
whether a developer has opted to rewrite part of the documentation during the
manual pass.

The documentation is also going to be significantly easier to read by hosting
the docs as a website rather than reading the Markdown files directly. AI
loves to **bold** or *italicize* words and add [links](#ai-generated-documentation)
to different sections, which noticeably hurts readability of the raw Markdown
docs.

## Status

This project is currently in early development. Expect missing features, janky
implementations, and UI/UX built around knowing the project ahead of time. The
project is not at a state where a user could pick up the project without any
knowledge about it and be able to use it to its full extent.
