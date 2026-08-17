//! **The `java.lang.Math` primitives TeaVM's WebAssembly backend leaves to its host**: the host side
//! of `test-cabinet:gg/math`.
//!
//! # Why gg answers arithmetic at all
//!
//! Because TeaVM's `WEBASSEMBLY_WASI` backend does not lower `Math.sin` to anything.
//! `java.lang.Math`'s transcendental methods are `native` in the classlib, annotated
//! `@Import(module = "teavmMath", …)`, and the backend emits them as **core imports of a module
//! named `teavmMath`**. TeaVM's own C runtime answers them with `#define teavmMath_sqrt sqrt` — that
//! is, with libc — and a WebAssembly component has no libc.
//!
//! Measured on the production route rather than reasoned about: a Kotlin program whose only unusual
//! line was `sqrt(16.0)` produced a core module gg could not encode at all, with
//! *"failed to resolve import `teavmMath::sqrt`: module requires an import interface named
//! `teavmMath`"*. Every arm's `Math.sqrt`, `Math.pow` and `Math.atan2` were unreachable, on both JVM
//! arms, and nothing had noticed because no test had used one.
//!
//! # How the two names are made one
//!
//! `teavmMath` is not a WIT interface id, so `wit-component` has nothing to resolve it against. What
//! makes it one is a [`ClassHolderTransformer`](../../../../packages/gg-sandbox-jvm/src/gg/internal/MathImports.java)
//! in each arm's SDK jar, named to TeaVM by the shared driver: it rewrites that annotation's
//! `module` to `test-cabinet:gg/math` on the way past, so what the backend emits is an import this
//! world declares. Nothing about the program changes; the same fourteen imports carry a different
//! module name.
//!
//! # Why these are Rust's own and not something gg computes
//!
//! Every one is `f64`'s own method, which is the platform's libm — the same function TeaVM's C
//! runtime would have reached through libc, so a program that ran through this and a program that
//! ran through that agree. Nothing here can fail: a `log(-1.0)` is `NaN` on this interface for the
//! same reason it is `NaN` in Java, and a function that returned a `tool-error` would be inventing a
//! failure mode `java.lang.Math` does not have.
//!
//! `random` is declared because the classlib annotates a method with it and is **not imported on
//! this target** — measured: `Math.random()` on `WEBASSEMBLY_WASI` reaches WASI's `random_get`
//! instead, and this is the WebAssembly-GC backend's spelling. It is answered from the same source
//! WASI would have used, so the two roads cannot disagree about what a random number is.

// Out of [the wire's own bindings](super::wire) rather than the `sandbox` world's, because this
// interface belongs to `jvm-sandbox`: the ten arms that are not JVM arms declare neither of the two.
use super::wire::test_cabinet::gg::math::Host as MathHost;
use super::{MembraneState, ToolApi};

impl<A: ToolApi> MathHost for MembraneState<A> {
    fn sin(&mut self, x: f64) -> f64 {
        x.sin()
    }

    fn cos(&mut self, x: f64) -> f64 {
        x.cos()
    }

    fn tan(&mut self, x: f64) -> f64 {
        x.tan()
    }

    fn asin(&mut self, x: f64) -> f64 {
        x.asin()
    }

    fn acos(&mut self, x: f64) -> f64 {
        x.acos()
    }

    fn atan(&mut self, x: f64) -> f64 {
        x.atan()
    }

    fn atan2(&mut self, y: f64, x: f64) -> f64 {
        y.atan2(x)
    }

    fn exp(&mut self, x: f64) -> f64 {
        x.exp()
    }

    fn log(&mut self, x: f64) -> f64 {
        x.ln()
    }

    fn pow(&mut self, base: f64, power: f64) -> f64 {
        base.powf(power)
    }

    fn sqrt(&mut self, x: f64) -> f64 {
        x.sqrt()
    }

    fn ceil(&mut self, x: f64) -> f64 {
        x.ceil()
    }

    fn floor(&mut self, x: f64) -> f64 {
        x.floor()
    }

    fn random(&mut self) -> f64 {
        // The same source WASI's `random_get` is, reached the same way the ambient WASI surface
        // reaches it, so the two roads cannot disagree about what a random number is. `getrandom` is
        // already in this crate's graph — it is what `wasmtime-wasi` fills `random_get` from — and a
        // second generator here would be a second answer to one question.
        //
        // 53 bits and a divide, which is `f64`'s whole mantissa: the result is uniform in [0, 1) and
        // is the construction `Math.random` is specified as everywhere it exists. A failure to read
        // the operating system's entropy answers 0.0 rather than trapping, because this interface
        // has no failure mode at all — and a host that could not produce entropy has a great deal
        // more wrong with it than one program's random number.
        let mut bytes = [0u8; 8];
        match getrandom::fill(&mut bytes) {
            Ok(()) => (u64::from_le_bytes(bytes) >> 11) as f64 / (1u64 << 53) as f64,
            Err(_) => 0.0,
        }
    }
}

/// Add this interface to the linker every component of this membrane is instantiated through.
///
/// Unconditional, exactly as [the wire's](super::wire) is: a linker offering an import a guest never
/// declares costs that guest nothing, and the ten arms that are not JVM arms never declare either of
/// these.
pub(crate) fn add_to_linker<A: ToolApi>(
    linker: &mut wasmtime::component::Linker<MembraneState<A>>,
) -> wasmtime::Result<()> {
    super::wire::test_cabinet::gg::math::add_to_linker::<_, wasmtime::component::HasSelf<_>>(
        linker,
        |state| state,
    )
}

#[cfg(test)]
#[path = "math.test.rs"]
mod tests;
