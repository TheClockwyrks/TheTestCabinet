//! **Reading a guest's frames back into the text the model wrote**, through the source map its own
//! compiler emitted.
//!
//! Some arms hand the guest a text that is not the one the model sent, because their compiler emits
//! source: `tsc` erases TypeScript's types by re-printing the program, so the statement a model
//! wrote on line 21 executes on line 11. The
//! [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) allow the resulting
//! location to be recovered **through a source map and by no other means**, and this is that
//! recovery: the map is the compiler's, the reader is [`sourcemap`], and nothing here computes a
//! line number.
//!
//! # The map travels inside the source
//!
//! An arm emits its JavaScript with the map inlined as the `sourceMappingURL` comment the ecosystem
//! already writes, so the map arrives wherever the source does — on a
//! [prepared program](super::language::PreparedProgram), on a
//! [code module](super::membrane::CodeModule) the turn was handed, and on a script prepared at a
//! skill's read and run turns later. Nothing has to carry it beside them and nothing can lose it on
//! the way.
//!
//! # What a rewritten frame says
//!
//! A frame the engine wrote as `program.js:11:9` is read back as `program.ts:21:1`: the file is the
//! one the map names as that token's source, and the line and column are the ones it resolves to. A
//! frame in a name no map covers is left exactly as the engine wrote it, which is what an SDK frame
//! and a host frame are.
//!
//! A map made from several sources therefore names several files. That is what a bundled arm needs:
//! one map covers the model's own file, the SDK's and every library's, and a frame reads as whichever
//! of them the token came from.
//!
//! # What is struck instead of rewritten
//!
//! Two frames name a place the model has no program at, and neither may be reported: a position in a
//! mapped text the map resolves nothing for, which is a line of the compiler's own output, and a
//! position in a source gg itself wrote to hold a bundle together. A frame that survives therefore
//! names a file the model wrote or a library its program compiled against, and a report that struck
//! anything closes by counting it.

use sourcemap::SourceMap;

/// One text the guest evaluates, and the map that reads a frame in it back to its own source.
struct Mapped {
    /// The name the guest declares the text under, which is the name its frames carry.
    guest: String,
    /// The one name every rewritten frame takes, for a text whose frames should all read as one
    /// thing whatever the map's own sources are called.
    ///
    /// `None` takes each frame's name from the map, which is the token's own source.
    reads_as: Option<String>,
    /// The compiler's own map from the text the guest evaluated to the text it was compiled from.
    map: SourceMap,
}

/// **Every text this program is made of that carries a map**, and what a frame in each reads as.
///
/// Built by the arm that produced the texts ([`ProgramLanguage::locations`](super::language::ProgramLanguage::locations)),
/// held by the [membrane state](super::membrane::MembraneState) for the life of one program, and
/// applied to everything the guest wrote to standard error before gg reports it.
pub(crate) struct Locations {
    /// Every text this program is made of that carries a map.
    texts: Vec<Mapped>,
    /// The sources in those maps that **gg** wrote rather than the model or a library, and whose
    /// frames are therefore struck.
    ///
    /// A bundled arm needs an entry module to point its bundler at, and that module is gg's: it
    /// names the entry point the model declared and the specifiers a turn's code modules are
    /// declared under. The bundler records it as a source like any other, so without this it reads
    /// back as an ordinary frame in a file the model never wrote and cannot open.
    ggs_own: Vec<String>,
}

impl Locations {
    /// Read the inline map each `(guest name, reads-as name, source)` carries, or `None` when not
    /// one of them carries a map.
    ///
    /// A source with no map contributes nothing rather than failing: an arm may map its program and
    /// not its modules, and a text with no map is one whose frames are already the model's.
    pub(crate) fn read<'a>(
        texts: impl IntoIterator<Item = (String, Option<String>, &'a str)>,
    ) -> Option<Self> {
        let texts: Vec<Mapped> = texts
            .into_iter()
            .filter_map(|(guest, reads_as, source)| {
                Some(Mapped {
                    guest,
                    reads_as,
                    map: embedded(source)?,
                })
            })
            .collect();
        (!texts.is_empty()).then_some(Self {
            texts,
            ggs_own: Vec::new(),
        })
    }

    /// The same locations with [gg's own sources](Self::ggs_own) named, for an arm that had to
    /// generate one.
    pub(crate) fn hiding(mut self, ggs_own: impl IntoIterator<Item = String>) -> Self {
        self.ggs_own = ggs_own.into_iter().collect();
        self
    }

    /// `text` with every frame located in a mapped source rewritten into that source's own
    /// coordinates, and every frame that names no source the model has struck.
    ///
    /// Each map is applied in turn over each line. That is safe rather than merely convenient: a
    /// rewritten frame names the source a map resolves to, and no arm files a map under a name
    /// another map resolves to, so a frame this pass rewrites is never a frame a later pass matches.
    ///
    /// A line is the unit because a frame is a line. Two of them are struck: one carrying a position
    /// in a mapped text the map resolved nothing for, which leaves the compiler's own coordinate
    /// behind, and one that resolved to a source in [gg's own](Self::ggs_own).
    pub(crate) fn rewrite(&self, text: &str) -> String {
        let mut kept = String::with_capacity(text.len());
        let mut struck = 0usize;
        for line in text.split_inclusive('\n') {
            let mut unresolved = false;
            let rewritten = self.texts.iter().fold(line.to_string(), |line, mapped| {
                let (line, missed) = mapped.rewrite(&line);
                unresolved |= missed;
                line
            });
            if unresolved
                || self
                    .ggs_own
                    .iter()
                    .any(|source| locates(&rewritten, source))
            {
                struck += 1;
                continue;
            }
            kept.push_str(&rewritten);
        }
        if struck == 0 {
            return kept;
        }
        if !kept.is_empty() && !kept.ends_with('\n') {
            kept.push('\n');
        }
        let frames = match struck {
            1 => "frame",
            _ => "frames",
        };
        kept.push_str(&format!(
            "… and {struck} more {frames}, in code this program was compiled into rather than in \
             code it contains."
        ));
        kept
    }
}

/// Whether `text` carries `name` followed by a `:<line>:<column>`, which is what a frame in `name`
/// looks like and what an ordinary mention of the name does not.
fn locates(text: &str, name: &str) -> bool {
    let mut rest = text;
    while let Some(at) = rest.find(name) {
        let after = &rest[at + name.len()..];
        if position(after).is_some() {
            return true;
        }
        rest = after;
    }
    false
}

impl Mapped {
    /// `text` with every `<guest>:<line>:<column>` rewritten into this map's own source and
    /// coordinates.
    ///
    /// Also **whether a position in this text went unresolved**, which is what tells
    /// [`Locations::rewrite`] to strike the line: a map is complete over the code its compiler
    /// emitted, so the positions that miss are the ones in text the compiler added of its own, and
    /// the coordinate left behind names a line of a program the model has never seen.
    ///
    /// A mention of the name that carries no position is not one of those, and is untouched.
    fn rewrite(&self, text: &str) -> (String, bool) {
        let mut out = String::with_capacity(text.len());
        let mut unresolved = false;
        let mut rest = text;
        while let Some(at) = rest.find(&self.guest) {
            let (before, from) = rest.split_at(at);
            out.push_str(before);
            let after = &from[self.guest.len()..];
            match position(after) {
                Some((line, column, tail)) => match self.resolve(line, column) {
                    Some((source, line, column)) => {
                        out.push_str(&format!("{source}:{line}:{column}"));
                        rest = tail;
                    }
                    None => {
                        unresolved = true;
                        out.push_str(&self.guest);
                        rest = after;
                    }
                },
                None => {
                    out.push_str(&self.guest);
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        (out, unresolved)
    }

    /// The source, 1-based line and 1-based column one 1-based generated position resolves to.
    ///
    /// The engine counts from one and a source map counts from zero, so both ends are converted
    /// here and nowhere else. That is the whole of the arithmetic in this module, and it is a change
    /// of base rather than a correction: no offset is added, and the numbers that come back are the
    /// map's.
    ///
    /// A lookup answers with the last token **at or before** the position. Where that token is on an
    /// earlier generated line, the position is one the map has nothing at or before on its own line
    /// — a call whose callee the compiler mapped on the line above, say — and the answer taken is
    /// the map's first token on the line the engine named instead. It is still the map's answer
    /// about the engine's own line rather than a number computed here.
    ///
    /// A generated line the map covers nowhere at all resolves to nothing, and so does a token the
    /// map names no source for: a line the compiler emitted with no mapping is a line the compiler
    /// wrote of its own, and reporting the nearest thing that happens to have a token on some other
    /// line would be gg inventing a location.
    fn resolve(&self, line: u32, column: u32) -> Option<(String, u32, u32)> {
        let line = line.checked_sub(1)?;
        let before = self.map.lookup_token(line, column.checked_sub(1)?);
        let token = match before.filter(|token| token.get_dst_line() == line) {
            Some(token) => token,
            None => self
                .map
                .tokens()
                .find(|token| token.get_dst_line() == line)?,
        };
        let source = match &self.reads_as {
            Some(name) => name.clone(),
            None => token.get_source()?.to_string(),
        };
        Some((source, token.get_src_line() + 1, token.get_src_col() + 1))
    }
}

/// The `:<line>:<column>` a frame carries after its file name, and whatever followed it.
///
/// `None` when what follows the name is not a position, which is what an ordinary mention of the
/// name in a message is.
fn position(after: &str) -> Option<(u32, u32, &str)> {
    let after = after.strip_prefix(':')?;
    let (line, after) = number(after)?;
    let after = after.strip_prefix(':')?;
    let (column, after) = number(after)?;
    Some((line, column, after))
}

/// One decimal number at the head of `text`, and whatever followed it.
fn number(text: &str) -> Option<(u32, &str)> {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let value = text[..end].parse().ok()?;
    Some((value, &text[end..]))
}

/// The map `source` carries inline, if it carries one.
///
/// Read with [`sourcemap`]'s own locator, which is what understands the `sourceMappingURL` comment
/// and the `data:` URL under it. A reference to a map in a *file* is not followed: this sandbox has
/// no file for one to be in, and an arm that emitted such a reference has emitted a map gg cannot
/// read rather than one it should go looking for.
pub(crate) fn embedded(source: &str) -> Option<SourceMap> {
    let located = sourcemap::locate_sourcemap_reference_slice(source.as_bytes()).ok()??;
    match located.get_embedded_sourcemap().ok()?? {
        sourcemap::DecodedMap::Regular(map) => Some(map),
        _ => None,
    }
}

#[cfg(test)]
#[path = "locate.test.rs"]
mod tests;
