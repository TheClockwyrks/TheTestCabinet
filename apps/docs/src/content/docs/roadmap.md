---
title: Roadmap
---

This document covers the changes that are planned for The Test Cabinet and the
(approximate) order that they'll be completed in. For what each released version
actually shipped, see the [changelogs](/changelogs/v0.2.0/).

## v0.3.0

- New test cases
- Add new types of test cases:
  - Adversarial
  - Asset generation
  - Performance
- Support for alternate execution modes
  - Ralph loop
  - Issue-based code generation
- Support for locally-hosted models

## Unscheduled

- Ablation testing
  - Test result quality with and without proof of completion
  - Evaluate results with and without Chromium/Playwright provided
- Use of less common languages
  - This would check how well models are able to generalize knowledge to more
    infrequently used languages
- Allow community contributions
  - Community-provided reviews+ratings
  - Community-provided run results (clearly labeled as unofficial)
    - Any community-provided implementation cannot be verified as having been
      autonomously implemented without user assistance and/or intervention, and
      is therefore not considered an official result
