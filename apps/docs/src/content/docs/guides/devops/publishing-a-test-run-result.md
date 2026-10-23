---
title: Publishing a Test Run Result
---

## Overview

A completed
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run
[publishes itself](/components/backend/results/#automatic-publishing) when it
finishes. This guide is for the runs that stay manual: a legacy run, a failed
run an operator decides to publish, and a run whose automatic publish failed.
Publishing is irreversible.

A manually published run reaches the gallery through two explicit steps, review
and publish, split so anyone may judge a run someone else produced (see
[Results: Lifecycle](/components/backend/results/#lifecycle)):

- A produced run's [run record](/components/contracts/run-records/) is stored on
  the backend when the run finishes, its build is playable off the
  [artifacts service](/components/artifacts/overview/), and its implementation
  is downloadable from the [repos service](/components/repos/overview/). The run
  stays private and is reviewable straight away.
- Review is anyone submitting an assessment for a produced run; see
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).
  A run may gather several reviews, one per identity.
- Publish releases the run's source and build publicly and flips it public. A
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run is
  publishable as soon as it completes; a legacy run is refused unless it has at
  least one review.

Both steps are the [console](/components/web/overview/)'s review and publish
actions on a run's page. The final product is released as it is, bugs and all,
rather than reduced to a score.

## Prerequisites

- An identity. Review and publish both record who acted, which is the Access
  identity the console session carries. See
  [Sign In](/quickstarts/setup/sign-in/).
- For a legacy run, a review submitted before you publish, since publishing
  refuses a legacy run with no review: a valid rating per domain and a
  non-empty body. A validator-rated run needs none, and a review on it
  supplies the run-wide aesthetic rating and any verdict overrides. Write the
  review first; see
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

The public release is the per-run GitHub repository and the Cloudflare Pages
build. It runs server-side at publish time, in the `tcab-publisher` Job and the
repos service, so the release credentials live on the cluster rather than on
your machine.

## Publish

Publish from the run's page in the console. Publishing a reviewed run releases
three things (see
[Results](/components/backend/results/#lifecycle) and
[Generated Code](/components/backend/results/#generated-code)):

- Source: the repos service creates the run's own public repository and pushes
  the implementation's bundle to it, keeping results independent and mapping
  onto per-run hosting. The implementation must include a README and whatever
  documentation a user needs to clone and run it locally; every test case
  requires that.
- Playable build: the `tcab-publisher` Job fetches the build output from the
  artifacts service and deploys it to Cloudflare Pages under a per-run branch
  alias, served at its own `pages.dev` root, which keeps it playable exactly as
  the test case's
  [build interface](/testing/end-to-end/overview/#design-requirements) and the
  [load check](/components/driver/validation/#load-check) require.
- Gallery: the backend marks the run published, has the artifacts service copy
  its media to the public bucket, writes the run's document and the updated
  index objects there, and mints the run's short code. The
  [gallery](/components/site/overview/) reads those objects at runtime, so the
  run appears with no site rebuild.

## Review then publish

When a different person should review a run, the steps split. A produced run is
already stored and its build playable, so a reviewer opens it in the console
straight away and submits a review under their own identity; a run gathers one
review per identity. An operator then publishes it from the console, which is
refused for a legacy run when no review exists. The backend performs the publish
alone, so two operators publishing at once cannot race on the record or the
public dataset.

## Preview before you publish

Play the build in the console before publishing; the console serves it from
the artifacts service, behind Access. The gallery shows only published runs.
