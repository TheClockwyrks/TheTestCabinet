/*
 * Included ahead of every C file the ECMAScript guest's quickjs is compiled from, through
 * `gg_ecmascript_cflags` in `packages/gg-sandbox/ecmascript-version.sh`, which says why quickjs is
 * compiled without `__wasi__`.
 *
 * The undefine was once a `-U__wasi__` on the command line. From wasi-sdk 34, `<wasi/version.h>` and
 * `<wasi/wasip1.h>` refuse to compile without `__wasi__`, and libc's own headers reach both. So
 * they are read here first, while the macro still stands, and their include guards keep every later
 * include of them from reading them again. Those two headers are the only ones in the target's
 * sysroot that test the macro outside libc++, which quickjs does not use, so libc reads exactly as it
 * did under `-U__wasi__` and quickjs is the only code that sees the difference.
 */
#include <wasi/api.h>
#undef __wasi__
