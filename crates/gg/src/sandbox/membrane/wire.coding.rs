//! **What travels inside the [wire](super)'s two byte lists**: gg's own tagged value
//! encoding, and the request/response frames built out of it.
//!
//! # Why an encoding of gg's own, and why not JSON
//!
//! The seam's rule that neither an argument nor a result is a JSON document a program has to parse
//! is a rule about the **model-facing** surface. This is the wire underneath it: a model writes
//! `Files.readFile("notes.txt")` against a typed method, and what that method lowers into is
//! gg's business, on both sides, forever. So the choice is made on what it costs the two ends rather
//! than on what it reads like.
//!
//! JSON costs the guest a parser. The JVM arms reach this wire from a TeaVM-compiled program whose
//! whole point is to be small and to start fast, and a JSON reader written in Java — string
//! scanning, escape handling, number parsing — is code compiled into **every program of every turn**
//! to move four fields. A tagged binary form needs no parser at all: every value states its own type
//! in one byte and its own length in four, so reading one is a bounds check and a slice.
//!
//! It also removes a whole class of silent wrongness. JSON has one number type; this wire tells an
//! `s32` from an `f64` in the tag, so a `timeout-secs` of `2` and a `2.0` cannot arrive as different
//! shapes, and a `u64` byte count cannot lose its low bits to a double on the way past.
//!
//! # The encoding
//!
//! Every integer in the frame — a tag's payload, a length, a count — is **little-endian**, because
//! wasm's linear memory is and the guest reads them out of a `byte[]` it just wrote.
//!
//! | tag | what follows |
//! | --- | --- |
//! | `0` | nothing. An absent `option`, and the value of a `result<_, …>` that succeeded |
//! | `1` | nothing. `false` |
//! | `2` | nothing. `true` |
//! | `3` | eight bytes: a signed 64-bit integer. Every WIT integer width lands here |
//! | `4` | eight bytes: an IEEE-754 double |
//! | `5` | `u32` byte length, then that many bytes of UTF-8 |
//! | `6` | `u32` count, then that many values |
//! | `7` | `u32` count, then that many (`u32` key length, key bytes, value) triples |
//!
//! A **record** is tag `7`, and its keys are the WIT field names **verbatim**, hyphens and all
//! (`exit-code`, `blocked-by`). One spelling, and it is the IDL's, so nothing has to remember
//! whether this layer renames.
//!
//! An **enum** is tag `5` carrying the WIT case name verbatim (`in-progress`). A **variant** is a
//! record with a `case` field carrying the case name and — where that case has a payload — a `value`
//! field carrying it. An **option** is either tag `0` or the value itself. A **list** is tag `6`.
//!
//! # The frames
//!
//! A **request** is one value: a list of the call's arguments, positionally, in the order the WIT
//! declares them. A call with no arguments sends an empty list rather than nothing, so the guest has
//! one code path.
//!
//! A **response** is one leading byte and then a value: `0` and what the call returned (tag `0` for
//! a call that returns nothing), or `1` followed by three text values — the failed call's key, the
//! wire spelling of its error code, and its message. That is the same three fields the `api-error`
//! record carries, and the guest raises them as its own language's `ApiError`.

use std::fmt;

/// One value on the wire: what a request's arguments are made of, and what a response carries back.
///
/// Deliberately not an owned mirror of any WIT type. It is the small alphabet the WIT's records,
/// variants, enums, options and lists are all written down in, so that the guest implements the
/// canonical ABI for a string and a byte list and nothing else.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Value {
    /// An absent `option`, or the value of a call that returns nothing.
    None,
    /// A `bool`.
    Bool(bool),
    /// Any WIT integer, widened. `u64` arrives here reinterpreted rather than saturated, because a
    /// byte count that wrapped is a wrong answer and one that saturated is a wrong answer that looks
    /// plausible.
    Int(i64),
    /// An `f64`.
    Float(f64),
    /// A `string`, or the case name of an `enum`.
    Text(String),
    /// A `list<T>`.
    List(Vec<Value>),
    /// A `record`, keyed by the WIT field names verbatim; also how a `variant` is written.
    Record(Vec<(String, Value)>),
}

/// The tag byte of an absent value.
const TAG_NONE: u8 = 0;
/// The tag byte of `false`.
const TAG_FALSE: u8 = 1;
/// The tag byte of `true`.
const TAG_TRUE: u8 = 2;
/// The tag byte of an integer.
const TAG_INT: u8 = 3;
/// The tag byte of a double.
const TAG_FLOAT: u8 = 4;
/// The tag byte of a string.
const TAG_TEXT: u8 = 5;
/// The tag byte of a list.
const TAG_LIST: u8 = 6;
/// The tag byte of a record.
const TAG_RECORD: u8 = 7;

/// The leading byte of a response the call returned from.
pub(crate) const RESPONSE_OK: u8 = 0;
/// The leading byte of a response the call failed with.
pub(crate) const RESPONSE_ERROR: u8 = 1;

/// The field a variant's case name is written under.
pub(crate) const VARIANT_CASE: &str = "case";
/// The field a variant's payload is written under.
pub(crate) const VARIANT_VALUE: &str = "value";

/// **A request gg could not read**, which is never the model's fault.
///
/// The SDK on the other side of this wire and the host on this side are built from the same
/// checkout, so a request that does not decode means the two artifacts have parted — a gg defect,
/// reported to the model as one rather than as an argument error it could act on. See
/// [the wire](super) for what it becomes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WireFault(String);

impl WireFault {
    /// A fault saying what was expected and what arrived.
    pub(crate) fn new(detail: impl Into<String>) -> Self {
        Self(detail.into())
    }
}

impl fmt::Display for WireFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/// A cursor over the bytes of one frame.
struct Reader<'a> {
    /// The frame.
    bytes: &'a [u8],
    /// How far in the cursor is.
    at: usize,
}

impl<'a> Reader<'a> {
    /// Take `count` bytes, or fault.
    fn take(&mut self, count: usize) -> Result<&'a [u8], WireFault> {
        let end = self.at.checked_add(count).ok_or_else(|| {
            WireFault::new(format!(
                "a length of {count} bytes at offset {} overflows the frame",
                self.at
            ))
        })?;
        if end > self.bytes.len() {
            return Err(WireFault::new(format!(
                "the frame ended after {} bytes with {count} still to read at offset {}",
                self.bytes.len(),
                self.at
            )));
        }
        let taken = &self.bytes[self.at..end];
        self.at = end;
        Ok(taken)
    }

    /// One byte.
    fn byte(&mut self) -> Result<u8, WireFault> {
        Ok(self.take(1)?[0])
    }

    /// A little-endian `u32`, as the count or length it always is.
    fn length(&mut self) -> Result<usize, WireFault> {
        let bytes = self.take(4)?;
        let value = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        Ok(value as usize)
    }

    /// A length-prefixed UTF-8 string.
    ///
    /// Invalid UTF-8 is a fault rather than a lossy conversion: the guest lowered a Java `String`,
    /// whose encoder cannot produce one, so bytes that are not UTF-8 mean the frame is not the frame
    /// this reader thinks it is and every offset after it is meaningless.
    fn text(&mut self) -> Result<String, WireFault> {
        let length = self.length()?;
        let bytes = self.take(length)?;
        String::from_utf8(bytes.to_vec())
            .map_err(|error| WireFault::new(format!("a string was not UTF-8: {error}")))
    }

    /// One value, whatever it is.
    fn value(&mut self) -> Result<Value, WireFault> {
        match self.byte()? {
            TAG_NONE => Ok(Value::None),
            TAG_FALSE => Ok(Value::Bool(false)),
            TAG_TRUE => Ok(Value::Bool(true)),
            TAG_INT => {
                let bytes = self.take(8)?;
                let mut eight = [0u8; 8];
                eight.copy_from_slice(bytes);
                Ok(Value::Int(i64::from_le_bytes(eight)))
            }
            TAG_FLOAT => {
                let bytes = self.take(8)?;
                let mut eight = [0u8; 8];
                eight.copy_from_slice(bytes);
                Ok(Value::Float(f64::from_le_bytes(eight)))
            }
            TAG_TEXT => Ok(Value::Text(self.text()?)),
            TAG_LIST => {
                let count = self.length()?;
                let mut items = Vec::with_capacity(count.min(1024));
                for _ in 0..count {
                    items.push(self.value()?);
                }
                Ok(Value::List(items))
            }
            TAG_RECORD => {
                let count = self.length()?;
                let mut fields = Vec::with_capacity(count.min(1024));
                for _ in 0..count {
                    let key = self.text()?;
                    fields.push((key, self.value()?));
                }
                Ok(Value::Record(fields))
            }
            other => Err(WireFault::new(format!(
                "tag {other} at offset {} is not a value",
                self.at - 1
            ))),
        }
    }
}

/// Decode one whole request frame: the list of arguments the guest lowered.
///
/// Trailing bytes are a fault rather than something to ignore. A frame with anything after the
/// value it declared is a frame the two sides disagree about the shape of, and reading the prefix
/// and carrying on is how a disagreement becomes a wrong answer instead of an error.
pub(crate) fn decode_request(bytes: &[u8]) -> Result<Vec<Value>, WireFault> {
    let mut reader = Reader { bytes, at: 0 };
    let value = reader.value()?;
    if reader.at != bytes.len() {
        return Err(WireFault::new(format!(
            "the request carried {} bytes after the arguments",
            bytes.len() - reader.at
        )));
    }
    match value {
        Value::List(arguments) => Ok(arguments),
        other => Err(WireFault::new(format!(
            "the request is {} rather than a list of arguments",
            other.shape()
        ))),
    }
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/// Append one value to `out`.
fn write(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::None => out.push(TAG_NONE),
        Value::Bool(false) => out.push(TAG_FALSE),
        Value::Bool(true) => out.push(TAG_TRUE),
        Value::Int(number) => {
            out.push(TAG_INT);
            out.extend_from_slice(&number.to_le_bytes());
        }
        Value::Float(number) => {
            out.push(TAG_FLOAT);
            out.extend_from_slice(&number.to_le_bytes());
        }
        Value::Text(text) => {
            out.push(TAG_TEXT);
            write_text(out, text);
        }
        Value::List(items) => {
            out.push(TAG_LIST);
            write_length(out, items.len());
            for item in items {
                write(out, item);
            }
        }
        Value::Record(fields) => {
            out.push(TAG_RECORD);
            write_length(out, fields.len());
            for (key, field) in fields {
                write_text(out, key);
                write(out, field);
            }
        }
    }
}

/// Append a length-prefixed string, without a tag.
fn write_text(out: &mut Vec<u8>, text: &str) {
    write_length(out, text.len());
    out.extend_from_slice(text.as_bytes());
}

/// Append a little-endian `u32` count.
///
/// Saturating rather than wrapping: nothing this membrane returns is anywhere near four billion
/// items or bytes — the read cap is 256 KiB and the view caps are smaller — and a length that
/// wrapped would make the guest read a valid-looking frame of the wrong shape, where one that
/// saturated makes it fault.
fn write_length(out: &mut Vec<u8>, length: usize) {
    out.extend_from_slice(&u32::try_from(length).unwrap_or(u32::MAX).to_le_bytes());
}

/// Encode the response of a call that returned `value`.
pub(crate) fn encode_ok(value: &Value) -> Vec<u8> {
    let mut out = vec![RESPONSE_OK];
    write(&mut out, value);
    out
}

/// Read a response frame back: what the call returned, or the three fields it failed with.
///
/// **The guest is what reads this in production** — this side only ever writes one — so this exists
/// for the tests, and it earns its place by being the thing that lets them assert on what the guest
/// will actually see rather than on the bytes gg happened to emit.
#[cfg(test)]
pub(super) fn decode_response(
    bytes: &[u8],
) -> Result<Result<Value, (String, String, String)>, WireFault> {
    let mut reader = Reader { bytes, at: 1 };
    let outcome = match bytes.first() {
        Some(&RESPONSE_OK) => Ok(reader.value()?),
        Some(&RESPONSE_ERROR) => Err((
            reader.value()?.text("the failed call")?,
            reader.value()?.text("the error code")?,
            reader.value()?.text("the message")?,
        )),
        other => {
            return Err(WireFault::new(format!(
                "a response starts with {other:?} rather than an outcome"
            )));
        }
    };
    if reader.at != bytes.len() {
        return Err(WireFault::new(format!(
            "the response carried {} bytes after the outcome",
            bytes.len() - reader.at
        )));
    }
    Ok(outcome)
}

/// Encode the response of a call that failed, as the three fields of an `api-error`.
pub(crate) fn encode_error(operation: &str, code: &str, message: &str) -> Vec<u8> {
    let mut out = vec![RESPONSE_ERROR];
    write(&mut out, &Value::Text(operation.to_owned()));
    write(&mut out, &Value::Text(code.to_owned()));
    write(&mut out, &Value::Text(message.to_owned()));
    out
}

// ---------------------------------------------------------------------------------------------
// Reading one argument
// ---------------------------------------------------------------------------------------------

impl Value {
    /// What this value is, for a fault's own sentence.
    fn shape(&self) -> &'static str {
        match self {
            Self::None => "absent",
            Self::Bool(_) => "a flag",
            Self::Int(_) => "a whole number",
            Self::Float(_) => "a number",
            Self::Text(_) => "text",
            Self::List(_) => "a list",
            Self::Record(_) => "a record",
        }
    }

    /// This value as text.
    pub(crate) fn text(&self, what: &str) -> Result<String, WireFault> {
        match self {
            Self::Text(text) => Ok(text.clone()),
            other => Err(WireFault::new(format!(
                "{what} arrived as {} rather than text",
                other.shape()
            ))),
        }
    }

    /// This value as text, or nothing.
    pub(crate) fn optional_text(&self, what: &str) -> Result<Option<String>, WireFault> {
        match self {
            Self::None => Ok(None),
            other => other.text(what).map(Some),
        }
    }

    /// This value as a whole number of `T`'s width, or a fault naming the range it left.
    pub(crate) fn integer<T: TryFrom<i64>>(&self, what: &str) -> Result<T, WireFault> {
        match self {
            Self::Int(number) => T::try_from(*number).map_err(|_| {
                WireFault::new(format!(
                    "{what} arrived as {number}, which is outside the range this call takes"
                ))
            }),
            other => Err(WireFault::new(format!(
                "{what} arrived as {} rather than a whole number",
                other.shape()
            ))),
        }
    }

    /// This value as a whole number, or nothing.
    pub(crate) fn optional_integer<T: TryFrom<i64>>(
        &self,
        what: &str,
    ) -> Result<Option<T>, WireFault> {
        match self {
            Self::None => Ok(None),
            other => other.integer(what).map(Some),
        }
    }

    /// This value as a double, or nothing.
    ///
    /// A whole number is accepted where a double is wanted, because a guest whose own type for the
    /// argument is an integer would otherwise have to know that this one field is different.
    pub(crate) fn optional_number(&self, what: &str) -> Result<Option<f64>, WireFault> {
        match self {
            Self::None => Ok(None),
            #[expect(
                clippy::cast_precision_loss,
                reason = "the one f64 argument on this membrane is a timeout in seconds, which is \
                          clamped to a day before it reaches a tool"
            )]
            Self::Int(number) => Ok(Some(*number as f64)),
            Self::Float(number) => Ok(Some(*number)),
            other => Err(WireFault::new(format!(
                "{what} arrived as {} rather than a number",
                other.shape()
            ))),
        }
    }

    // THERE IS NO READER FOR A FLAG, and that is a fact about the membrane rather than an
    // omission: no function on it takes a `bool` argument. A flag is written — `truncated`,
    // `shown`, `ok` — and never read. One would be added beside the first argument that needs it.

    /// This value as a list.
    pub(crate) fn list(&self, what: &str) -> Result<&[Value], WireFault> {
        match self {
            Self::List(items) => Ok(items),
            other => Err(WireFault::new(format!(
                "{what} arrived as {} rather than a list",
                other.shape()
            ))),
        }
    }

    /// This value as a list of text.
    pub(crate) fn texts(&self, what: &str) -> Result<Vec<String>, WireFault> {
        self.list(what)?
            .iter()
            .map(|item| item.text(what))
            .collect()
    }

    /// This value as a list of text, or nothing.
    pub(crate) fn optional_texts(&self, what: &str) -> Result<Option<Vec<String>>, WireFault> {
        match self {
            Self::None => Ok(None),
            other => other.texts(what).map(Some),
        }
    }

    /// One field of this record, or a fault naming the field that is missing.
    ///
    /// A field the guest left out is a fault rather than an absent `option`: an `option` is written
    /// as tag `0` and is present. What a missing key means is that the two ends disagree about the
    /// record's shape.
    pub(crate) fn field(&self, what: &str, name: &str) -> Result<&Value, WireFault> {
        match self {
            Self::Record(fields) => fields
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value)
                .ok_or_else(|| WireFault::new(format!("{what} carried no `{name}` field"))),
            other => Err(WireFault::new(format!(
                "{what} arrived as {} rather than a record",
                other.shape()
            ))),
        }
    }
}

/// The value at `index` of an argument list, or a fault naming the call that is short of arguments.
pub(crate) fn argument<'a>(
    arguments: &'a [Value],
    op: &str,
    index: usize,
) -> Result<&'a Value, WireFault> {
    arguments.get(index).ok_or_else(|| {
        WireFault::new(format!(
            "`{op}` was called with {} arguments and wants at least {}",
            arguments.len(),
            index + 1
        ))
    })
}

/// A record, from its fields.
pub(crate) fn record<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Record(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// A whole number, whatever width it arrived at.
pub(crate) fn integer(number: impl Into<i64>) -> Value {
    Value::Int(number.into())
}

/// A `u64`, reinterpreted rather than saturated — see [`Value::Int`].
#[expect(
    clippy::cast_possible_wrap,
    reason = "the two u64 fields on this membrane are a byte count and a token count; \
              reinterpreting keeps every bit, where saturating would invent a plausible wrong \
              answer"
)]
pub(crate) fn wide(number: u64) -> Value {
    Value::Int(number as i64)
}

/// Text.
pub(crate) fn text(value: impl Into<String>) -> Value {
    Value::Text(value.into())
}

/// A list of text.
pub(crate) fn texts(values: impl IntoIterator<Item = String>) -> Value {
    Value::List(values.into_iter().map(Value::Text).collect())
}

/// A value that may be absent.
pub(crate) fn optional<T>(value: Option<T>, lower: impl FnOnce(T) -> Value) -> Value {
    value.map_or(Value::None, lower)
}

#[cfg(test)]
#[path = "wire.coding.test.rs"]
mod tests;
