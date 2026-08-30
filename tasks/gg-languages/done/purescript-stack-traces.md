# PureScript Runtime Frames Name The Model's Program

A runtime failure on the PureScript arm returns frames from inside gg's SDK. The
model receives ten frames and none of them are in the program it wrote:

```
    at <anonymous> (output/Gg.Internal.Wire/foreign.js:47:21)
    at <anonymous> (output/Effect/foreign.js:10:16)
    … and 5 more frames, inside gg's SDK rather than in code this program contains.
```

Every other arm names the model's own line, such as `program.ts:7:7` or
`./program.cs:line 5`.

## Causes

`crates/gg/src/sandbox/language/purescript.rs` calls `.hiding([ENTRY_FILE])`,
which strikes gg's generated `entry.js` alone. This arm compiles its SDK into the
same bundle as the response, so a resolved position lands in
`output/Gg.Internal.Wire/foreign.js`. The guest's `own_frames` strikes the
`native`, `sdk:` and `test-cabinet:gg/` prefixes, which describe arms where the
SDK stays outside the bundle.

Several SDK calls reach the model through a functor lift, such as
`Gg/Views.purs`:

```purescript
… <$> Wire.call "read_file" …
```

The lift drops the model's own frame. The highest-traffic calls use it, including
`Gg.Shell.shell`, `Gg.Views.openFile`, `Gg.Files.readFile` and `Gg.Docs.search`.
The G8 gate documents the consequence and drives this arm's cell with a direct
`Wire.call` instead, so the weakness stays outside what the gate measures.

## Design

Strike the SDK's own emitted modules from the frame set alongside `entry.js`.
Write the calls that reach the model as direct `Wire.call` sites so the model's
frame survives.

Drive the G8 gate's PureScript cell through a lifted call so the property is
measured where it was failing.

## Done when

- [x] A runtime failure names `program.purs` and the model's own line.
- [x] SDK frames are struck from the reported set.
- [x] The G8 gate exercises this arm through a call the model actually reaches for.
- [x] Gates green.
