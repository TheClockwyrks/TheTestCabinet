---
title: The Test Cabinet
---

The Test Cabinet is an evaluation suite for AI models and harnesses. Every run
is assessed two ways. Automated validation builds the implementation, loads it,
and drives it through the debug tooling each test case requires, confirming that
the spelled-out mechanics work. A reviewer then runs the final build and judges
the qualities automation cannot.

Each run earns a numeric score, the checklist points it earned out of the points
available, and a functional rating for each of the case's scoring domains, both
decided by the case's validators on current case versions. A reviewer adds an
aesthetic rating per domain. A run's overall rating on either channel is the
worst of its domain ratings, so a flawless mode cannot mask a broken one. Each
test case has a per-variant leaderboard ranking the harness and model pairings
that have scored runs of it.

Test cases are deliberately large. They answer how well a model handles a large,
complex task and takes it to completion autonomously, rather than how well it
completes a small task inside an existing codebase.

## Audience

This documentation serves developers working on The Test Cabinet and users who
run it themselves. Runs are launched from the command line, from the desktop
app, or from the web console. Every path enqueues the run at the backend, and a
dispatcher creates a per-run driver `Job` to execute it.

Developers should start with the [Components](/components/architecture/)
section. Users should start with [First Time
Setup](/guides/setup/first-time-setup/) and then work through the
[Quickstarts](/quickstarts/overview/) and [User Guides](/guides/overview/).

## AI Documentation Policy

The Test Cabinet's documentation is primarily written by AI after a human
developer describes the intended implementation/design. In this sense, AI acts
exclusively as a printer rather than an author, albeit a printer that's capable
of filling in more mundane but still important details. High level design and
the overall direction is entirely human driven and never originates from AI.

## Status

The project is in early development. Expect missing features, rough
implementations, and a UI that assumes prior knowledge of the project.
