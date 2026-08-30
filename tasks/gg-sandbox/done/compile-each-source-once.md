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

A read of bytes a key already holds is answered from the preparation that
produced them, so a skill an agent uses on every turn costs one compile for the
session.

A module is compiled against gg's surface and the arm's library set, so it sees
those and its own declarations. One loaded module reaches another by being
written to take what it needs as an argument. This is what every arm but C# did
already, and the C# arm joins them: its modules were built in binding order
inside a program's own compile, and building each at its read is what moves that
cost off the turn.

This depends on `workspace-per-agent.md`, which gives the build output somewhere
to live across turns.

## Done when

- [x] A loaded code module is compiled once per session.
- [x] A turn's compile covers the response and reuses existing module build output.
- [x] A gate asserts module compile count stays flat as turns accumulate.
- [x] Gates green.
