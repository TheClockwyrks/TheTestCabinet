---
title: Publish a Run
---

## Overview

Publishing releases a run to public hosting and the gallery. A produced run's
record, tree and bundle are already stored privately by the driver. A completed
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run
[publishes itself](/components/backend/results/#automatic-publishing) when it
finishes, so it needs none of the steps below. They are for the runs that stay
manual: a legacy run, which is reviewed first, a failed run an operator decides
to publish, and a run whose automatic publish failed
([lifecycle](/components/backend/results/#lifecycle)).
Publishing is irreversible. The full workflow is
[Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/).

## Prerequisites

- You are [signed in](/quickstarts/setup/sign-in/): reviewing and publishing
  each record the Access identity the request carries.
- A legacy run carries at least one
  [review](/quickstarts/development/review-a-run/). Publishing a legacy run with
  no review is refused; a validator-rated run needs none.

The GitHub and Cloudflare credentials the release itself needs live with the
repos service and the publisher Job, not on your machine.

## From the console

In the [console](/components/web/overview/), open the run. The console offers
Submit review and Publish run as separate actions, with Publish gated on a
legacy run carrying a review.

## Who reviews

When someone else reviews the run, they submit the review from the console
under their own identity (the format is in
[Review a Run](/quickstarts/development/review-a-run/)), and the run is
published from the console afterwards. A validator-rated run needs no review
before it is published.

## What publishing releases

- Source: the run's implementation, pushed by the repos service to its own
  public repository.
- Playable build: the built implementation, deployed by the publisher Job to
  Cloudflare Pages at its own per-run subdomain.
- Gallery: the run's document, media and short code, written to the public
  bucket the gallery reads at runtime. The console's share control then offers
  the run's `tcab.ai` links.

The release runs as a `tcab-publisher` Job; the console shows its progress
until the release reports its outcome.
