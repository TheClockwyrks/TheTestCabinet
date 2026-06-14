# Test Cases

## Overview

A test case is a single game that a model is asked to build. Test cases range
from simple cases such as Pong through to highly complex cases that require
significant assistance from a coding harness for even the best models to
complete. Test cases are intentionally designed to exceed the capabilities of
current state of the art models so that they remain relevant as models and
harnesses improve.

## Catalog Layout

Test cases live in the repository under a top level `test-cases/` folder. Each
test case has its own folder named with a stable slug, and each slug contains one
folder per version:

```
test-cases/<slug>/<version>/
```

Versioning a test case independently allows its design to be revised over time.
Revisions are expected, both to refine a case and to change details between
benchmark runs so that contamination from training data has less impact. Each
version must be self contained so that a run always references an exact,
immutable version.

## Contents

Each test case version must contain:

- A **specification** that describes the game the model must build. This is the
  vision spec for the test case and is the primary material handed to the model.
  It may record both high and low level details, including mechanics, layouts,
  states, and rules.
- **Reference visuals** in the form of mockups or images that are representative
  of the UIs that must be implemented. These are provided so that
  implementations can be visually compared against an intended design.
- **Assets** such as sprites that the model should use, when the case requires
  assets that should not be left to the model to generate.
- **Validation criteria** describing what can be checked automatically. See
  [Validation](./validation.md).

The specification and assets are what gets seeded into a run. See
[Execution](./execution.md#seeding).

## Assets

The goal of The Test Cabinet is to evaluate model capability on large software
development tasks, not asset generation. A test case must therefore either be
simple enough that no assets are needed, or it must pre-provide the assets a
model should use.

- Simple cases such as Pong need no assets and may leave all visuals to the
  model.
- More involved cases must provide a set of assets so that each run does not have
  to produce its own, which would make runs less comparable.

## Design Requirements

Every test case must satisfy the following:

- It must be **inspired by but not a clone of** the original game. Test cases may
  reuse mechanics from the games that inspire them, but must not recreate the
  original assets, branding, or exact designs. All specifications, reference
  visuals, and assets must be original works produced for The Test Cabinet.
- The final product must **not require API keys**. A visitor must be able to play
  a published implementation without supplying any credentials or incurring any
  cost.
- The final product must **not require backend support**. Every test case must be
  runnable in a browser with no accounts, databases, or other significant server
  side dependencies.
- It must be possible to **specify visuals precisely enough** that an initial
  automated assessment pass can compare an implementation against the reference
  visuals.

## Provided Tests

A test case may provide some tests as part of its specification. These tests must
not be hidden from the model, and the model must not be blocked from writing
additional tests of its own. The challenge of a test case must come from the
case itself, not from the testing harness withholding information. See
[Execution](./execution.md#model-authored-tests).
