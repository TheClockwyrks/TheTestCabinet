# Execution

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
**only** the data a model needs to build the game: the test case's specification
and its assets.

- A new repository must be created per run so that no prior history exists. Models
  have been observed solving tasks by reading git history to recover a deleted
  reference implementation; starting from an empty history removes that
  possibility.
- The seeded repository must begin from a clean initial commit with no upstream
  remote and no history beyond that commit.
- A test case's **reference visuals must not be seeded**. They are harness-side
  validation material; seeding them would let a model copy the intended UI
  instead of building it from the specification, the same kind of shortcut the
  fresh repository is meant to prevent.
- The seeded specification must be **self-contained**, with no links or
  references to these harness docs or to any file outside the seeded repository,
  because none of them exist inside the container. See
  [Test Cases](./test-cases.md#self-contained-specifications).

## Model Authored Tests

The goal of a test case is to measure how well a model writes code in a large
project, so the testing harness must not get in the way of the model testing its
own work.

- Any tests a test case provides must be visible to the model.
- The model must not be blocked from writing its own tests.

## Artifact Collection

When a run finishes, the testing harness must collect the run's working tree as
the run's primary artifact. This produced repository is what gets validated and,
if published, released. See [Results](./results.md).
