---
title: "Responses as code"
---

An alternative to traditional tool calling: agents **emit code**, and gg executes it
in a **[wasmtime](https://wasmtime.dev/) sandbox** rather than dispatching discrete
tool calls. The agent expresses what it wants to do as a program over the available
tools — loops, conditionals, intermediate values, several tool invocations composed
together — which the sandbox runs, returning the result.

This is well-trodden ground for us: the same approach is already implemented and
well understood in another of the author's projects (and wasmtime is already the
sandbox The Test Cabinet's [Foray](/testing/adversarial/foray/architecture/) engine
runs untrusted controllers in), so it is a low-risk capability to bring to gg. It
can be toggled against traditional tool calling to measure whether code-shaped
responses help a model tackle the large [Hard](/testing/end-to-end/) cases.
