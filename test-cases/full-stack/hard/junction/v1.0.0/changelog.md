Introduced. The city's core simulation is authored in Rust and compiled to WebAssembly
during the run (committed as a build input), driven by a JS/TS view layer; the build also
produces its own sprites, effects, and audio with the on-`PATH` asset tools.
