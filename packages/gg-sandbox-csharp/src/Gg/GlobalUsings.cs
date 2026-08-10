// What is in scope before a program writes its first line.
//
// WHY THIS FILE EXISTS AT ALL. gg's surface lives in `namespace Gg`, and a model's reply is compiled
// verbatim — no wrapper, no prologue, so a diagnostic at line 7 is line 7. A `using Gg;` typed into
// the program by gg would break that, and one a model had to remember to type would be a compile
// error on the turn it forgot. A `global using` is C#'s own answer: it applies to every file of the
// compilation, including the model's, without touching a byte of it. It is the same mechanism .NET's
// own implicit usings use, and this arm's SDK is compiled in the same compilation as the program, so
// it works for exactly the same reason.
//
// WHAT IS DELIBERATELY ABSENT. `System.Threading` and `System.Threading.Tasks`. Every call on this
// surface is synchronous, there is no event loop inside the guest for an `await` to yield to, and
// work a program deferred is work that reports success and never runs. Leaving them out of scope
// does not forbid them — a program may still write the `using` itself — but nothing about the
// default scope suggests they are the shape to reach for. It also keeps `Tasks` unambiguous: the
// namespace `System.Threading.Tasks` and this SDK's `Gg.Tasks` module would otherwise be two things
// under one name, and `Tasks.TaskStatus` would stop resolving.
//
// `System.Net.Http` is absent for a different reason, and one a program can measure: its native
// handler is not in this guest (see `packages/gg-sandbox-csharp/build.sh`), so the types compile and
// the transport is gone. The network is reached the way every arm reaches it, through `Shell.Run`.
//
// WHAT IS DELIBERATELY *NOT* HERE: a `global using static` per module. It would put every function
// of the surface into the program's scope under a bare name, and the module qualification is the
// discovery backbone — a call written `Files.ReadFile` says which module documents it, and a call
// written `ReadFile` says nothing. A program that wants the shorter form writes
// `using static Gg.Files;` for itself, which is C#'s own idiom and is the program's choice rather
// than gg's.

// == gg ==
// The whole model-facing surface: the eleven capability modules, the types nested in them, and the
// exception they throw.
global using Gg;

// == The everyday ==
global using System;
global using System.Collections.Generic;
global using System.Linq;

// == Text ==
global using System.Text;
global using System.Text.RegularExpressions;

// == Files and paths ==
// A real WASI filesystem, so `File.ReadAllText` and `Path.Combine` work on the workspace. `Files`
// is still the module gg records and that a capped read policy applies to.
global using System.IO;
