---
title: Overview
---

The Backend component is a Rust server that serves both runners and reporters.
Runners query the backend for container and test case definitions, then report
test case results to the backend. Reporters can then query the backend for
test case definitions and results to display.
