//! A small clap helper shared by the three binaries.
//!
//! Audio parameters are routinely negative — a voice `--gain -6` (dB), a `--pan -0.5`,
//! a compressor `--threshold -18`. By default clap treats a leading-`-` token as a
//! flag and rejects it, so this parses the CLI with **negative numbers allowed on
//! every subcommand**, which is what lets `--gain -3` bind as a value rather than error.

use clap::Parser;

/// Parse `C` from the process arguments, allowing negative numeric values on the root
/// command and every subcommand. Exits (via clap's own error/`--help` path) on a parse
/// error, exactly as `C::parse()` would.
pub fn parse_allowing_negatives<C: Parser>() -> C {
    let mut cmd = C::command().allow_negative_numbers(true);
    let names: Vec<String> = cmd
        .get_subcommands()
        .map(|s| s.get_name().to_owned())
        .collect();
    for name in names {
        cmd = cmd.mut_subcommand(name, |s| s.allow_negative_numbers(true));
    }
    let matches = cmd.get_matches();
    match C::from_arg_matches(&matches) {
        Ok(cli) => cli,
        Err(err) => err.exit(),
    }
}
