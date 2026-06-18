---
title: Roadmap
---

This document covers the changes that are planned for The Test Cabinet and the
(approximate) order that they'll be completed in.

## v0.2.0

- Introduce all additional components documented for The Test Cabinet
  - v0.1.0 only introduces the CLI, website, and documentation

## v0.3.0

- Add new types of test cases:
  - Adversarial
  - Asset generation
  - Performance

## Unscheduled

- Requiring models to supply proof of completion (images, video)
- Ablation testing
  - Test result quality with and without proof of completion
  - Evaluate results with and without Chromium/Playwright provided
- Use of less common languages
  - This would check how well models are able to generalize knowledge to more
    infrequently languages
- Support for alternate execution modes
  - Ralph loop
  - Issue-based code generation
- Allow community contributions
  - Community-provided reviews+ratings
  - Community-provided run results (clearly labeled as unofficial)
    - Any community-provided implementation cannot be verified as having been
      autonomously implemented without user assistance and/or intervention, and
      is therefore not considered an official result
- Revise the website to better support mobile
  - Implementations won't be playable on mobile since they'll expect KB&M for
    input, but the rest of the site needs to use responsive design
