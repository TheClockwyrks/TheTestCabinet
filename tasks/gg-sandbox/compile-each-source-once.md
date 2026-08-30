# Compile Each Source Once

A response compiles exactly once. A loaded code module compiles once per session,
and later turns reuse its build output.

## Current behaviour

`Knowledge::code_modules` (`crates/gg/src/knowledge.rs`) returns every module the
agent has loaded so far, and `compile_program` writes and compiles all of them
beside the program on every turn. A workspace created per preparation leaves the
compiler without build output for those modules, so each turn compiles every
loaded module from source again. Turn cost therefore grows with the number of
modules the agent has read.

Responses themselves are already compiled once. Each preparation writes the
program to a single fixed filename in its own workspace, so a submitted program
stays out of later compilations, including when one turn submits several
programs.

## Design

Compile a module when it is loaded and keep its build output in the agent's
workspace. A later preparation compiles the response against that output.

This depends on `workspace-per-agent.md`, which gives the build output somewhere
to live across turns.

## Done when

- [ ] A loaded code module is compiled once per session.
- [ ] A turn's compile covers the response and reuses existing module build output.
- [ ] A gate asserts module compile count stays flat as turns accumulate.
- [ ] Gates green.
