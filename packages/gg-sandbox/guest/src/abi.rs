//! The hand-written half of the membrane lowering: the scalar lifts and lowers, and the three
//! shape checks the generated glue in `$OUT_DIR/membrane.rs` is written in terms of.
//!
//! Everything here is about **one** question — what does a component-model value look like as a
//! JavaScript value, and what does gg do when it is handed one of the wrong shape — and the answer
//! is stated once rather than fifty-five times. The generator emits calls into this; nothing here
//! knows anything about gg's WIT.
//!
//! # Strict, and it matters which way
//!
//! Nothing here coerces. A `string` parameter handed a number is a `TypeError` naming the parameter,
//! not `String(5)`; a `bigint` field handed a `number` is a `TypeError`, not a silent truncation.
//! That is the canonical mapping's own behaviour — jco's lowering throws for exactly these — and it
//! is the behaviour a model can learn from: a coercion turns a mistake into a call that succeeds
//! wrongly, and the model never finds out.

// The generator emits calls to the subset of these gg's WIT actually reaches, and which subset that
// is moves whenever a family is added. A helper with no call site today is not dead code, it is a
// shape gg's membrane does not currently use.
#![allow(dead_code)]

use rquickjs::function::Rest;
use rquickjs::{Array, BigInt, Ctx, Error, Exception, IntoJs, Object, Result, Value};

/// The positional argument at `index`, or `undefined` when the caller passed fewer.
///
/// Absence and `undefined` are the same thing here, deliberately: the canonical mapping makes an
/// `option<T>` a **positional** parameter typed `T | undefined`, so a call that stops short is a
/// call that passed `undefined` for the rest — which is what the SDK does for a trailing option it
/// has nothing to say about.
pub fn argument<'js>(ctx: &Ctx<'js>, arguments: &Rest<Value<'js>>, index: usize) -> Value<'js> {
    arguments
        .0
        .get(index)
        .cloned()
        .unwrap_or_else(|| Value::new_undefined(ctx.clone()))
}

/// `None` for `undefined` and for `null`, `Some` for anything else.
///
/// Both, because the SDK's own `opts` helper lowers a missing optional to `undefined` while a
/// program that read a value out of JSON will have `null` — and refusing the second would make a
/// round trip through `JSON.parse` a type error for no reason a model could act on.
pub fn absent(value: Value<'_>) -> Option<Value<'_>> {
    if value.is_undefined() || value.is_null() {
        None
    } else {
        Some(value)
    }
}

/// One field of a record, as a raw value. A field the object does not have reads as `undefined`,
/// which is what makes an optional field optional.
pub fn field<'js>(object: &Object<'js>, name: &str) -> Result<Value<'js>> {
    object.get::<_, Value<'js>>(name)
}

/// A value that must be an object, with the name of the WIT type in the message when it is not.
pub fn as_object<'js>(ctx: &Ctx<'js>, value: &Value<'js>, what: &str) -> Result<Object<'js>> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| type_error(ctx, &format!("{what} must be an object, not {}", kind(value))))
}

/// A value that must be an array.
pub fn as_array<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<Array<'js>> {
    value
        .into_array()
        .ok_or_else(|| type_error(ctx, "expected an array"))
}

/// A value that must be a string.
pub fn from_js_string<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<String> {
    match value.as_string() {
        Some(text) => text.to_string(),
        None => Err(type_error(
            ctx,
            &format!("expected a string, got {}", kind(&value)),
        )),
    }
}

/// A value that must be a number. `u32`, `s32`, `f64` and every other WIT scalar but the 64-bit
/// integers land here, and the generated glue casts.
pub fn from_js_number<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<f64> {
    if let Some(int) = value.as_int() {
        return Ok(f64::from(int));
    }
    value.as_float().ok_or_else(|| {
        type_error(ctx, &format!("expected a number, got {}", kind(&value)))
    })
}

/// A value that must be a boolean.
pub fn from_js_bool<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<bool> {
    value
        .as_bool()
        .ok_or_else(|| type_error(ctx, &format!("expected a boolean, got {}", kind(&value))))
}

/// A value that must be a `bigint`, which is what the canonical mapping makes of `u64` and `s64`.
pub fn from_js_big_int<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<i64> {
    match value.into_big_int() {
        Some(big) => big.to_i64(),
        None => Err(type_error(ctx, "expected a bigint")),
    }
}

/// A `u64` as the `bigint` the canonical mapping makes of it.
pub fn big_int_u64<'js>(ctx: &Ctx<'js>, value: u64) -> Result<Value<'js>> {
    BigInt::from_u64(ctx.clone(), value)?.into_js(ctx)
}

/// An `s64` as a `bigint`.
pub fn big_int_i64<'js>(ctx: &Ctx<'js>, value: i64) -> Result<Value<'js>> {
    BigInt::from_i64(ctx.clone(), value)?.into_js(ctx)
}

/// A `TypeError` raised in the guest, ready to be returned as an `Err`.
pub fn type_error(ctx: &Ctx<'_>, message: &str) -> Error {
    Exception::throw_type(ctx, message)
}

/// What a value is, in the word a JavaScript programmer would use, for a type error's message.
fn kind(value: &Value<'_>) -> &'static str {
    if value.is_undefined() {
        "undefined"
    } else if value.is_null() {
        "null"
    } else if value.is_bool() {
        "a boolean"
    } else if value.is_number() {
        "a number"
    } else if value.is_string() {
        "a string"
    } else if value.is_array() {
        "an array"
    } else if value.is_function() {
        "a function"
    } else if value.is_object() {
        "an object"
    } else {
        "something else"
    }
}
