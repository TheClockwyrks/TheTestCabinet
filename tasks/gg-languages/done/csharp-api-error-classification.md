# C# Reports API Failures As API Failures

An uncaught gg API failure is recorded as `program_api_error` on every arm. The
C# arm records it as `program_throw`.

## Current behaviour

`report()` in `packages/gg-sandbox-csharp/Sources/shell.c` sets
`error.kind = ERROR_KIND_OTHER` with no code, and every unhandled managed
exception routes through it. `crates/gg/src/sandbox/membrane/capture.rs` maps
that pair to `ProgramErrorKind::Other`, which becomes
`TurnErrorType::ProgramThrow`.

The information needed to classify is already in the guest. `Gg.ApiException`
carries `Code` and `Operation` (`packages/gg-sandbox-csharp/src/Gg/Core/Errors.cs`).

`program_unknown_name` requires `ErrorCode::Unavailable`, so it is unreachable on
this arm. A C# program reaching for a withheld capability is recorded as
`program_throw`.

The effect is visible in recorded runs. A `views.open_file` call on a missing
path is `program_throw` on C# and `program_api_error` on the TypeScript,
JavaScript, Python and PureScript runs of the same test case.

## Scope

Audit every arm's guest for the same shape and fix each one that flattens an API
failure into a generic throw. `crates/gg/src/sandbox/outcome.rs` states that an
uncaught failed call is `ProgramApiError` on every arm whose guest reports one;
make that true and bring the arm's gate cell in `csharp.substrate.test.rs` and
the note in `apps/docs/src/content/docs/gg/telemetry/turn-outcomes.md` onto it.

## Design

Inspect the thrown object in the guest's report path. Carry the exception's code
and operation into the error it reports, so the membrane classifies the failure
the way it classifies every other arm's.

## Done when

- [x] An uncaught gg API failure is `program_api_error` on the C# arm.
- [x] A withheld capability is `program_unknown_name` on the C# arm.
- [x] Every other arm's guest is audited and any arm with the same shape is fixed.
- [x] The gate cells and the telemetry documentation state one rule for all arms.
- [x] Gates green.
