//! The published form of a gg run's session record: its JSON read one value at
//! a time and written again with every string and object key scrubbed.
//!
//! A record carries its run's whole model conversation and can be hundreds of
//! megabytes of JSON. Parsing one into a [`serde_json::Value`] costs several
//! times its size, which a backend that publishes records on every refresh and
//! compares them on every sweep pass cannot pay. [`scrub_record`] therefore
//! never holds the record: each value goes from the reader to the writer as it
//! is read. A refresh writes into a bounded buffer ([`export_record`]) and the
//! state sweep into a hash ([`record_digest`]), so the two cannot disagree
//! about what a record is published as.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::io::{Read, Write};

use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{self, Serialize, SerializeMap, SerializeSeq, Serializer};
use test_cabinet_core::redact::SecretScrubber;

/// The largest published form of a session record a refresh uploads.
///
/// A refresh holds one whole object in memory to `PUT` it, so this is what one
/// record can cost the backend. Twice gg's default journal ceiling
/// ([`AUTHORED_REPLAY_MAX_BYTES`](test_cabinet_core::gg::AUTHORED_REPLAY_MAX_BYTES)),
/// so no record a run writes under the default limits is refused.
pub(crate) const MAX_PUBLISHED_RECORD_BYTES: usize = 512 * 1024 * 1024;

/// Why a stored session record has no published form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecordFailure {
    /// The bytes could not be read, do not decompress, or are not one JSON
    /// document.
    NotADocument,
    /// The published form is larger than the bound it was written under.
    TooLarge,
}

impl RecordFailure {
    /// The failure as a log line's reason.
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Self::NotADocument => "the stored bytes are not a readable JSON document",
            Self::TooLarge => "the record's published form is over the size bound",
        }
    }
}

/// The scrubber and whether it has redacted anything yet.
struct Scrub<'a> {
    /// What redacts.
    scrubber: &'a SecretScrubber,
    /// Whether any string or key was changed.
    redacted: Cell<bool>,
}

impl Scrub<'_> {
    /// `text` with every secret redacted.
    fn text<'t>(&self, text: &'t str) -> Cow<'t, str> {
        let scrubbed = self.scrubber.scrub(text);
        if matches!(scrubbed, Cow::Owned(_)) {
            self.redacted.set(true);
        }
        scrubbed
    }
}

/// A value still in its deserializer, which serializing it reads.
struct Unread<'a, D> {
    /// The deserializer positioned at the value, taken by the one serialization.
    source: RefCell<Option<D>>,
    /// The scrubber every string of the value passes.
    scrub: &'a Scrub<'a>,
}

impl<'de, D: Deserializer<'de>> Serialize for Unread<'_, D> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let source = self
            .source
            .borrow_mut()
            .take()
            .ok_or_else(|| ser::Error::custom("a value is read once"))?;
        source
            .deserialize_any(Emit {
                serializer,
                scrub: self.scrub,
            })
            .map_err(ser::Error::custom)
    }
}

/// Writes the value it visits to `serializer`.
struct Emit<'a, S> {
    /// Where the value goes.
    serializer: S,
    /// The scrubber every string of the value passes.
    scrub: &'a Scrub<'a>,
}

impl<'de, S: Serializer> Visitor<'de> for Emit<'_, S> {
    type Value = S::Ok;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<S::Ok, E> {
        self.serializer.serialize_bool(value).map_err(E::custom)
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<S::Ok, E> {
        self.serializer.serialize_i64(value).map_err(E::custom)
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<S::Ok, E> {
        self.serializer.serialize_u64(value).map_err(E::custom)
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<S::Ok, E> {
        self.serializer.serialize_f64(value).map_err(E::custom)
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<S::Ok, E> {
        self.serializer
            .serialize_str(&self.scrub.text(value))
            .map_err(E::custom)
    }

    fn visit_unit<E: de::Error>(self) -> Result<S::Ok, E> {
        self.serializer.serialize_unit().map_err(E::custom)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut items: A) -> Result<S::Ok, A::Error> {
        let mut out = self
            .serializer
            .serialize_seq(None)
            .map_err(de::Error::custom)?;
        while items
            .next_element_seed(Element {
                out: &mut out,
                scrub: self.scrub,
            })?
            .is_some()
        {}
        out.end().map_err(de::Error::custom)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut members: A) -> Result<S::Ok, A::Error> {
        let mut out = self
            .serializer
            .serialize_map(None)
            .map_err(de::Error::custom)?;
        // The redacted keys this object has been given, so that two keys the
        // scrubber redacts to one text stay two members. Empty for every object
        // with no secret in a key, which is all but none of them.
        let mut redacted_keys: HashSet<String> = HashSet::new();
        while let Some(key) = members.next_key::<String>()? {
            match self.scrub.text(&key) {
                Cow::Borrowed(clean) => out.serialize_key(clean),
                Cow::Owned(scrubbed) => {
                    let mut name = scrubbed.clone();
                    let mut ordinal = 2usize;
                    while !redacted_keys.insert(name.clone()) {
                        name = format!("{scrubbed} ({ordinal})");
                        ordinal += 1;
                    }
                    out.serialize_key(&name)
                }
            }
            .map_err(de::Error::custom)?;
            members.next_value_seed(Member {
                out: &mut out,
                scrub: self.scrub,
            })?;
        }
        out.end().map_err(de::Error::custom)
    }
}

/// Reads one element of an array straight into `out`.
struct Element<'o, 'a, Q> {
    /// The array being written.
    out: &'o mut Q,
    /// The scrubber every string of the element passes.
    scrub: &'a Scrub<'a>,
}

impl<'de, Q: SerializeSeq> DeserializeSeed<'de> for Element<'_, '_, Q> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, source: D) -> Result<(), D::Error> {
        self.out
            .serialize_element(&Unread {
                source: RefCell::new(Some(source)),
                scrub: self.scrub,
            })
            .map_err(de::Error::custom)
    }
}

/// Reads one member's value of an object straight into `out`.
struct Member<'o, 'a, Q> {
    /// The object being written.
    out: &'o mut Q,
    /// The scrubber every string of the value passes.
    scrub: &'a Scrub<'a>,
}

impl<'de, Q: SerializeMap> DeserializeSeed<'de> for Member<'_, '_, Q> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, source: D) -> Result<(), D::Error> {
        self.out
            .serialize_value(&Unread {
                source: RefCell::new(Some(source)),
                scrub: self.scrub,
            })
            .map_err(de::Error::custom)
    }
}

/// Write the published form of the session record read from `stored` to `out`:
/// its JSON, uncompressed, with every string and every object key passed
/// through `scrubber`. Returns whether anything was redacted.
///
/// `stored` is gzip, of one member or several, or plain JSON, told apart by the
/// gzip magic as the serving route tells them. Nothing but one buffered part of
/// the input and what `out` keeps is held, whatever the record's size.
///
/// The output is the record's values in the record's order: the keys of an
/// object are not sorted and a repeated key is written each time. Whitespace
/// between values is dropped, and a number is written as `serde_json` writes
/// the 64-bit integer or float it read.
///
/// An `Err` for bytes that cannot be read, do not decompress or are not one
/// JSON document, and for an `out` that refused a write. What `out` was given
/// by then is a fragment.
pub(crate) fn scrub_record<R: Read, W: Write>(
    mut stored: R,
    out: W,
    scrubber: &SecretScrubber,
) -> Result<bool, RecordFailure> {
    let mut magic = [0u8; 2];
    let mut read = 0;
    while read < magic.len() {
        match stored.read(&mut magic[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err(RecordFailure::NotADocument),
        }
    }
    let whole = std::io::Cursor::new(magic).take(read as u64).chain(stored);
    let plain: Box<dyn Read + '_> = if magic[..read] == [0x1f, 0x8b] {
        Box::new(flate2::read::MultiGzDecoder::new(std::io::BufReader::new(
            whole,
        )))
    } else {
        Box::new(whole)
    };
    let scrub = Scrub {
        scrubber,
        redacted: Cell::new(false),
    };
    let mut source = serde_json::Deserializer::from_reader(std::io::BufReader::new(plain));
    let mut sink = serde_json::Serializer::new(out);
    source
        .deserialize_any(Emit {
            serializer: &mut sink,
            scrub: &scrub,
        })
        .map_err(|_| RecordFailure::NotADocument)?;
    // One document and nothing after it, as a parse of the whole file requires.
    source.end().map_err(|_| RecordFailure::NotADocument)?;
    Ok(scrub.redacted.get())
}

/// A buffer that refuses to grow past `limit`.
struct Bounded {
    /// What was written.
    bytes: Vec<u8>,
    /// The most bytes it takes.
    limit: usize,
    /// Whether a write was refused.
    over: bool,
}

impl Write for Bounded {
    fn write(&mut self, part: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len().saturating_add(part.len()) > self.limit {
            self.over = true;
            return Err(std::io::Error::other("the session record is too large"));
        }
        self.bytes.extend_from_slice(part);
        Ok(part.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The published form of the session record read from `stored`, and whether
/// the scrub redacted anything: what a refresh uploads.
///
/// [`RecordFailure::TooLarge`] for a record whose published form is over
/// `limit` bytes, found without holding more than `limit` of it.
pub(crate) fn export_record<R: Read>(
    stored: R,
    scrubber: &SecretScrubber,
    limit: usize,
) -> Result<(Vec<u8>, bool), RecordFailure> {
    let mut out = Bounded {
        bytes: Vec::new(),
        limit,
        over: false,
    };
    match scrub_record(stored, &mut out, scrubber) {
        Ok(redacted) => Ok((out.bytes, redacted)),
        Err(_) if out.over => Err(RecordFailure::TooLarge),
        Err(failure) => Err(failure),
    }
}

/// Counts and hashes what is written to it, and keeps none of it.
struct Tally {
    /// The MD5 of the bytes so far.
    md5: md5::Md5,
    /// How many bytes that is.
    size: u64,
}

impl Write for Tally {
    fn write(&mut self, part: &[u8]) -> std::io::Result<usize> {
        md5::Digest::update(&mut self.md5, part);
        self.size += part.len() as u64;
        Ok(part.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The size and the MD5 of the published form of the session record read from
/// `stored`, as a refresh would upload it now. `None` for bytes with no
/// published form.
///
/// The form is hashed as it is written and never held, so the state sweep
/// compares a record of any size in the memory of one buffer.
pub(crate) fn record_digest<R: Read>(stored: R) -> Option<(u64, [u8; 16])> {
    let mut digest = Tally {
        md5: md5::Digest::new(),
        size: 0,
    };
    let mut out = std::io::BufWriter::new(&mut digest);
    scrub_record(stored, &mut out, &SecretScrubber::new()).ok()?;
    out.flush().ok()?;
    drop(out);
    Some((digest.size, md5::Digest::finalize(digest.md5).into()))
}

#[cfg(test)]
#[path = "snapshot.record.test.rs"]
mod tests;
