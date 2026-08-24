-- | Read, write, edit, search and list the files of the workspace.
-- |
-- | Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
-- | that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
-- | large files in a single turn will exhaust its fuel budget.
-- |
-- | Nothing here places anything in the agent's context window: a value a program gets back from
-- | this module is the program's alone until a view shows it.
module Gg.Files
  ( readFile
  , readTextFile
  , writeFile
  , editFile
  , listDir
  , search
  , FileRead(..)
  , TextFile
  , ImageFile
  , DirEntry
  , EntryKind(..)
  , SearchMatch
  , ReadOptions
  , ListDirOptions
  , SearchOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Read (fileRead)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The window of lines a read covers. Every field is optional; `{}` reads the whole file.
type ReadOptions = (offset :: Int, limit :: Int)

-- | Which directory to list. Optional; `{}` lists the workspace root.
type ListDirOptions = (path :: String)

-- | Where a search looks and how many matches it takes. Every field is optional; `{}` searches the
-- | whole workspace for the first 50.
type SearchOptions = (path :: String, limit :: Int)

-- | The result of a read: a text file's window, or a picture's description.
-- |
-- | A picture is a different kind of thing from text, so it is a different arm rather than a string
-- | that happens to be binary — a program that treats an image as text is caught by the `case`
-- | instead of quietly writing an empty string somewhere. Image bytes never enter the program: gg
-- | attaches the picture to the turn instead, which is worth more than base64 in a variable.
data FileRead
  -- | The file is text.
  = TextFile TextFile
  -- | The file is a picture, described rather than handed over as bytes.
  | ImageFile ImageFile

-- | A text file's window, as the `TextFile` arm of a read carries it.
-- |
-- | # Fields
-- |
-- | - `contents` — The file's text, or the requested window alone where the read named one.
-- | - `firstLine` — The 1-based first line returned.
-- | - `lastLine` — The 1-based last line returned.
-- | - `totalLines` — The file's total line count, which is what says whether another page is left.
-- | - `byteTruncated` — Whether a 256 KiB byte ceiling cut the returned text.
type TextFile =
  { contents :: String
  , firstLine :: Int
  , lastLine :: Int
  , totalLines :: Int
  , byteTruncated :: Boolean
  }

-- | A picture's description, as the `ImageFile` arm of a read carries it.
-- |
-- | # Fields
-- |
-- | - `mediaType` — The IANA media type: `image/png`, `image/jpeg`, `image/gif` or `image/webp`.
-- | - `label` — The short format label: `PNG`, `JPEG`, `GIF` or `WebP`.
-- | - `bytes` — The file's size in bytes.
-- | - `shown` — Whether the picture is being attached to this turn to be looked at.
-- | - `notShownReason` — Why it is not being attached; `Nothing` when `shown` is true.
type ImageFile =
  { mediaType :: String
  , label :: String
  , bytes :: Int
  , shown :: Boolean
  , notShownReason :: Maybe String
  }

-- | One entry of a listed directory.
-- |
-- | # Fields
-- |
-- | - `name` — The entry's bare name, with no directory part.
-- |
-- |   Joining it with the directory that was listed is what produces a path another call accepts.
-- | - `kind` — What the entry is.
type DirEntry =
  { name :: String
  , kind :: EntryKind
  }

-- | What a directory entry is.
data EntryKind
  -- | An ordinary file.
  = FileEntry
  -- | A directory, which can be listed in turn.
  | DirectoryEntry
  -- | Everything that is neither, a symlink among them.
  | OtherEntry

derive instance Eq EntryKind
derive instance Generic EntryKind _
instance Show EntryKind where
  show = genericShow

-- | One line a search matched: where it is, and the line itself.
-- |
-- | # Fields
-- |
-- | - `path` — The file the line is in, relative to the workspace.
-- |
-- |   It is a path every other call accepts as it stands, so a match is already an argument for a
-- |   windowed read of the lines around it.
-- | - `line` — The 1-based number of the line within that file.
-- | - `text` — The line, without its ending.
-- |
-- |   One longer than 200 characters is cut there and annotated in place as `foo (123 more
-- |   chars...)`, so a minified bundle cannot put a page into one match.
type SearchMatch =
  { path :: String
  , line :: Int
  , text :: String
  }

derive instance Eq FileRead
derive instance Generic FileRead _
instance Show FileRead where
  show = genericShow

-- | Read a file, as either the `TextFile` or the `ImageFile` arm of a `Gg.Files.FileRead`.
-- |
-- | Which of the two comes back is detected from the file's bytes, never from the extension, so a
-- | mislabelled picture is still a picture. The sum is closed, so an ordinary `case` needs no
-- | catch-all:
-- |
-- | ```
-- | read <- Gg.Files.readFile "logo.png" {}
-- | case read of
-- |   Gg.Files.TextFile text -> Gg.Views.openText "logo" text.contents
-- |   Gg.Files.ImageFile picture -> Gg.Views.openText "logo" picture.label
-- | ```
-- |
-- | A relative path resolves against the workspace; an absolute one is read as given, so anything
-- | else in this container — an offloaded command's output under `/tmp/gg-shell`, say — is readable.
-- | This call hands bytes to the program and places nothing in the context window, and reading a
-- | picture describes it without showing it, so a file only read here is a file nobody has looked at.
-- |
-- | # Operation
-- |
-- | files.read_file
-- |
-- | # Arguments
-- |
-- | - `path` — The file to read, relative to the workspace or absolute.
-- | - `options` — The window of lines to read; `{}` reads the whole file.
-- | - `options.offset` — The 1-based line to start at. Left out, the read starts at the first line.
-- | - `options.limit` — How many lines to return from `offset`. Left out, a capped read policy's
-- |   default applies, or the read runs to the end of the file.
-- |
-- | # Returns
-- |
-- | The `TextFile` arm for a text file's window, or the `ImageFile` arm describing a picture whose
-- | bytes never entered the program.
-- |
-- | # Throws
-- |
-- | `NotFound` for a missing path.
readFile
  :: forall given rest
   . Union given rest ReadOptions
  => String
  -> Record given
  -> Effect FileRead
readFile path options =
  fileRead TextFile ImageFile
    <$> Wire.call "read_file" "files" "Gg.Files.readFile" [ Wire.wire path, Wire.lower {} options ]

-- | Read a text file and hand back its contents directly.
-- |
-- | `Gg.Files.readFile` without the narrowing, for the common case: the same read, the same window,
-- | the same cost.
-- |
-- | # Operation
-- |
-- | files.read_text_file
-- |
-- | # Arguments
-- |
-- | - `path` — The file to read, relative to the workspace or absolute.
-- | - `options` — The window of lines to read; `{}` reads the whole file.
-- | - `options.offset` — The 1-based line to start at. Left out, the read starts at the first line.
-- | - `options.limit` — How many lines to return from `offset`. Left out, a capped read policy's
-- |   default applies, or the read runs to the end of the file.
-- |
-- | # Returns
-- |
-- | The file's text, or the window of it the read asked for.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` when the path names a picture, which `Gg.Files.readFile` inspects instead and
-- | `Gg.Views.openFile` displays.
readTextFile
  :: forall given rest
   . Union given rest ReadOptions
  => String
  -> Record given
  -> Effect String
readTextFile path options =
  Wire.call "read_file" "files" "Gg.Files.readTextFile" [ Wire.wire path, Wire.lower {} options ]

-- | Write UTF-8 text to a file, creating parent directories and replacing what is there.
-- |
-- | Writing is the expensive direction of this sandbox: rewriting more than a few dozen large files
-- | in one program exhausts its fuel budget, so a large rewrite is best split across several turns.
-- |
-- | # Operation
-- |
-- | files.write_file
-- |
-- | # Arguments
-- |
-- | - `path` — Where to write, relative to the workspace or absolute. Parent directories are created.
-- | - `contents` — The UTF-8 text to write. It replaces the file entirely.
-- |
-- | # Returns
-- |
-- | How many bytes were written, which is the UTF-8 length rather than the number of characters.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty path, and `IoError` when creating the parent directories or the
-- | write itself failed.
writeFile :: String -> String -> Effect Int
writeFile path contents =
  Wire.call "write_file" "files" "Gg.Files.writeFile" [ Wire.wire path, Wire.wire contents ]

-- | Replace the one exact occurrence of some text in a file with something else.
-- |
-- | Widening the surrounding context until the match is unique is the way to disambiguate; counting
-- | occurrences is not.
-- |
-- | # Operation
-- |
-- | files.edit_file
-- |
-- | # Arguments
-- |
-- | - `path` — The file to edit.
-- | - `oldString` — The exact text to find, whitespace included. It must appear exactly once.
-- | - `newString` — The text to put in its place. An empty string deletes the match.
-- |
-- | # Throws
-- |
-- | `NotFound` when the text does not appear, and `Conflict` — with the number of matches — when it
-- | appears more than once.
editFile :: String -> String -> String -> Effect Unit
editFile path oldString newString =
  Wire.call_ "edit_file" "files" "Gg.Files.editFile"
    [ Wire.wire path, Wire.wire oldString, Wire.wire newString ]

-- | List a directory, sorted by name; `{}` lists the workspace root.
-- |
-- | # Operation
-- |
-- | files.list_dir
-- |
-- | # Arguments
-- |
-- | - `options` — Which directory to list; `{}` lists the workspace root.
-- | - `options.path` — The directory to list, relative to the workspace or absolute.
-- |
-- | # Returns
-- |
-- | One entry per name, sorted by name, and an empty array for an empty directory rather than a
-- | failure. Each `name` is bare, so joining it with the directory that was listed is what makes a
-- | path.
-- |
-- | # Throws
-- |
-- | `NotFound` for a directory that is not there, and `InvalidArgument` for a `path` that is given
-- | but empty — leaving it out altogether is what lists the workspace root.
listDir
  :: forall given rest
   . Union given rest ListDirOptions
  => Record given
  -> Effect (Array DirEntry)
listDir options =
  map dirEntry <$> Wire.call "list_dir" "files" "Gg.Files.listDir" [ Wire.pick "path" options ]

-- | Search the workspace's files for a regular expression, honouring the ignore files.
-- |
-- | A search answers *where* rather than *what*: each match is a path, a 1-based line number and
-- | the line, which is what points a windowed read or a view at the right lines of the right file.
-- | The query is the pattern a `grep` would take — a regular expression in Rust syntax: `foo|bar`,
-- | `fn\s+update`, `(?i)todo` for a case-insensitive match — tried against each line on its own.
-- |
-- | Ignoring is the search's own rule rather than an option. What `.gitignore`, `.ignore` and
-- | `.git/info/exclude` exclude — nested files and negations included, and `.git` itself — is never
-- | scanned and never returned, in a workspace that is a repository and in one that is not yet.
-- | Dotfiles are otherwise searched like any other file, and a file that is not text (one carrying
-- | a NUL byte) is skipped rather than matched byte by byte. A match list therefore holds the
-- | project's sources rather than `node_modules`, build output and the run's own bookkeeping; a file
-- | under an ignored path is still reachable by path through every other call.
-- |
-- | The result is bounded so one search cannot flood a turn: `limit` is 50 when left out and never
-- | more than 200, and a list exactly `limit` long may have been cut. There is no offset, because a
-- | search is a question about where to look rather than a way of reading a file, so the answer to
-- | a cut list is a narrower query or a narrower `path`.
-- |
-- | # Operation
-- |
-- | files.search
-- |
-- | # Arguments
-- |
-- | - `query` — The pattern to look for: a regular expression in Rust syntax, tried against each
-- |   line on its own. `(?i)` makes it case-insensitive.
-- | - `options` — Where to look and how many matches to take; `{}` searches the whole workspace for
-- |   the first 50.
-- | - `options.path` — The directory to search under, or the one file to search, relative to the
-- |   workspace or absolute. Left out, the search starts at the workspace root.
-- | - `options.limit` — The most matches to return. Left out, 50 applies; a request above 200 is
-- |   answered with the first 200 rather than refused.
-- |
-- | # Returns
-- |
-- | The matching lines in path order and then line order, each with its path and 1-based line
-- | number, and an empty array — rather than a failure — when nothing matched. A list exactly
-- | `limit` long may have been cut.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a blank query, for one that is not a valid regular expression, and for a
-- | `limit` of zero; `NotFound` for a `path` that is not there.
search
  :: forall given rest
   . Union given rest SearchOptions
  => String
  -> Record given
  -> Effect (Array SearchMatch)
search query options =
  Wire.call "search" "files" "Gg.Files.search" [ Wire.wire query, Wire.lower {} options ]

-- | One directory entry, with its kind as an arm rather than a word.
dirEntry :: Wire.Wire -> DirEntry
dirEntry value =
  { name: Wire.text "name" value
  , kind: entryKind (Wire.text "kind" value)
  }

-- | What a directory entry is. Anything that is neither a file nor a directory is `OtherEntry`,
-- | which is the arm the wire's own `other` means.
entryKind :: String -> EntryKind
entryKind = case _ of
  "file" -> FileEntry
  "directory" -> DirectoryEntry
  _ -> OtherEntry
