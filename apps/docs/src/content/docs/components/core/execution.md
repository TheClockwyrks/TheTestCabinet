---
title: Execution
---

## Overview

Every run executes inside an isolated, containerized environment seeded with a
fresh git repository. Isolation protects the host, keeps runs from discovering
each other's work, and prevents models from finding solutions in places they
should not be looking.

## Containerization

Runs must occur in a container so that a model cannot access the host system.
Without this, a model could discover other runs' outputs or damage the host, for
example by deleting files.

- The testing harness must support Docker and compatible container runtimes such
  as Podman through a runtime abstraction, rather than hard coding a single
  runtime.
- A container must not have access to the host filesystem beyond the seeded
  repository and the inputs the run explicitly provides.
- A container does require outbound network access so the agent harness can reach
  model APIs and install packages. Isolation is about protecting the host
  filesystem and other runs' outputs, not about disabling the network.

## Seeding

Each run must be seeded into its own newly created git repository that contains
the data a model needs to build the game: the specs of the selected variant, the
test case's assets, and the rendered reference screenshots that serve as visual
targets. A run selects exactly one
[variant](/components/core/test-cases/#variants), and the variant's specs are seeded at their
declared `dest` paths — the common specs plus that variant's own — rather than as
a single specification at the repository root.

- A new repository must be created per run so that no prior history exists. Models
  have been observed solving tasks by reading git history to recover a deleted
  reference implementation; starting from an empty history removes that
  possibility.
- The seeded repository must begin from a clean initial commit with no upstream
  remote and no history beyond that commit.
- A spec whose source is a Handlebars template (a `.hbs` extension) is
  **rendered** with the selected variant and version while seeding, and the
  result lands at the spec's `dest`; every other spec is copied verbatim. This
  lets a spec state per-variant facts directly instead of hedging about what a run
  might contain. See [Spec templates](/components/core/test-cases/#spec-templates).
- A test case's **reference screenshots are seeded** as visual targets so the
  model can see what each screen should look like. The reference **source**
  mockups are **not** seeded: handing over the mockup HTML/CSS would let a model
  copy the intended UI instead of building it from the specification, the same
  kind of shortcut the fresh repository is meant to prevent. A screenshot conveys
  the target without giving away the implementation.
- The seeded specs must be **self-contained**, with no links or references to
  these harness docs or to any file outside the seeded repository, because none
  of them exist inside the container. They may, however, point at the seeded
  reference screenshots. See
  [Test Cases](/components/core/test-cases/#self-contained-specifications).
- The prompt is **not seeded** to disk. It is rendered from the version's
  `prompt.hbs` template — with the run's in-container workspace path and the
  selected variant's seeded spec paths — and handed directly to the harness as
  its instruction. See [Prompt template](/components/core/test-cases/#prompt-template).

The seeded repository is normally created, mounted, and torn down as part of a
run, so its contents are never visible on their own. The `tcab seed` command runs
this same seeding step for a chosen variant (`--variant`) and leaves the result
on disk (under `tmp/` by default) so the exact inputs a harness receives — the
variant's seeded specs, the seeded assets, and the fresh git history — can be
inspected without launching a container. Because the prompt is not seeded,
`tcab prompt` renders and prints the instruction a run would hand the harness for
a given variant, without seeding or launching anything.

## Model Authored Tests

The goal of a test case is to measure how well a model writes code in a large
project, so the testing harness must not get in the way of the model testing its
own work.

- Any tests a test case provides must be visible to the model.
- The model must not be blocked from writing its own tests.

## Artifact Collection

When a run finishes, the testing harness must collect the run's working tree as
the run's primary artifact. This produced repository is what gets validated and,
if published, released. See [Results](/components/core/results/).
