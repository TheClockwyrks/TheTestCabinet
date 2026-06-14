# Validation

## Overview

Validation is an automated first pass over a finished implementation. Its purpose
is to catch gross failures cheaply and, where a test case calls for it, to compare
an implementation against the reference visuals it was given.

Full automated validation is **not** a goal. It is not expected that an entire
implementation can be assessed automatically. Validation produces signals that are
surfaced on the [site](./site.md); it is not a pass/fail gate and it does not
produce a ranking. The real evaluation is a person playing the implementation.

## Load Check

The most important automated check is whether the implementation runs at all.
Many failures are gross: the build fails, or the page throws an error on load and
nothing renders. The testing harness must:

- Build the implementation and serve it as a static site.
- Load it in a headless browser.
- Detect fatal errors, including build failures and uncaught runtime errors that
  prevent the application from rendering.
- Capture screenshots of the loaded application.

A run that cannot load is the clearest possible signal and must be recorded as
such.

## Reference Comparison

When a test case's specification mandates a specific UI, such as a particular menu
layout, that UI can be validated by comparing a screenshot of the implementation
against the reference visual the test case provides.

- A test case declares which views can be compared and the reference visual for
  each.
- The testing harness captures the corresponding screenshots during the load
  check and compares them against the references.
- The result is a similarity signal recorded with the run, not a strict match
  requirement.

## Results

Validation output is summarized into the [run record](./run-records.md) so the
site can surface, for example, whether a run loaded and how closely it matched any
declared reference views.
