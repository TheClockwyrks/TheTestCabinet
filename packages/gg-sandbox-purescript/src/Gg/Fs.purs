-- | The `fs` object: reading, writing, editing and listing files in the workspace.
module Gg.Fs
  ( fs
  , readFile
  , readTextFile
  , writeFile
  , editFile
  , listDir
  , ReadOptions
  , ListDirOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (dirEntry, fileRead)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (DirEntry, FileRead, FunctionSummary)
import Prim.Row (class Union)

-- | The window of lines a read covers. Every field is optional; `{}` reads the whole file.
type ReadOptions = (offset :: Int, limit :: Int)

-- | Which directory to list. Optional; `{}` lists your workspace root.
type ListDirOptions = (path :: String)

-- | read, write, and edit workspace files
fs
  :: { readFile ::
         forall given rest
          . Union given rest ReadOptions
         => String
         -> Record given
         -> Effect FileRead
     , readTextFile ::
         forall given rest
          . Union given rest ReadOptions
         => String
         -> Record given
         -> Effect String
     , writeFile :: String -> String -> Effect Int
     , editFile :: String -> String -> String -> Effect Unit
     , listDir ::
         forall given rest
          . Union given rest ListDirOptions
         => Record given
         -> Effect (Array DirEntry)
     , list :: Effect (Array FunctionSummary)
     }
fs =
  { readFile
  , readTextFile
  , writeFile
  , editFile
  , listDir
  , list: listOn "fs"
  }

-- | Read a file, handing back a `TextFile` or an `ImageFile` — the format is detected from the
-- | file's bytes, never its extension.
-- |
-- | This gets bytes for your PROGRAM and puts NOTHING in your context window; `view.openFile` is the
-- | call that shows the file to you. A relative path resolves against your workspace; an absolute
-- | one is read as given, so anything in this container — an offloaded command's output under
-- | `/tmp/gg-shell`, say — is readable.
-- |
-- | Reading an IMAGE describes it to your program — label, media type, byte size — and does not show
-- | it to YOU: the pixels reach neither your program nor your context window, so a file you only
-- | `fs.readFile` is a file you have not looked at. `view.openFile` is the one way to actually see a
-- | picture.
-- |
-- | Narrow the two arms with an ordinary `case`:
-- |
-- | ```
-- | read <- fs.readFile "logo.png" {}
-- | case read of
-- |   TextFile text -> view.openText "logo" text.contents
-- |   ImageFile picture -> view.openText "logo" picture.label
-- | ```
-- |
-- | # Arguments
-- |
-- | - `path` — The file to read. Relative to your workspace, or absolute for anything else in this
-- |   container.
-- | - `options` — The window of lines to read; pass `{}` to read the whole file.
-- | - `options.offset` — The 1-based line to start at. Honoured only under a capped read policy.
-- | - `options.limit` — How many lines to return from `offset`. Honoured only under a capped read
-- |   policy.
-- |
-- | # Raises
-- |
-- | `NotFound` for a missing path.
readFile
  :: forall given rest
   . Union given rest ReadOptions
  => String
  -> Record given
  -> Effect FileRead
readFile path options =
  fileRead <$> Wire.call "read_file" "fs" "readFile" [ Wire.wire path, Wire.lower {} options ]

-- | Read a text file and hand back its contents directly — `fs.readFile` without the narrowing, for
-- | the common case.
-- |
-- | It takes the same window options. Reading is the cheap direction of this sandbox, so a program
-- | that reads a dozen files to decide what to change is doing the right thing.
-- |
-- | # Arguments
-- |
-- | - `path` — The file to read. Relative to your workspace, or absolute.
-- | - `options` — The window of lines to read; pass `{}` to read the whole file.
-- | - `options.offset` — The 1-based line to start at. Honoured only under a capped read policy.
-- | - `options.limit` — How many lines to return from `offset`. Honoured only under a capped read
-- |   policy.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` when the path names a picture; use `fs.readFile` to inspect those, and
-- | `view.openFile` to look at one.
readTextFile
  :: forall given rest
   . Union given rest ReadOptions
  => String
  -> Record given
  -> Effect String
readTextFile path options =
  Wire.call "read_file" "fs" "readTextFile" [ Wire.wire path, Wire.lower {} options ]

-- | Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
-- | hand back the number of bytes written.
-- |
-- | Writing is the expensive direction of the sandbox — rewriting more than a few dozen large files
-- | in one program exhausts its fuel budget, so split a large rewrite across several turns.
-- |
-- | # Arguments
-- |
-- | - `path` — Where to write. Relative to your workspace, or absolute. Parent directories are
-- |   created for you.
-- | - `contents` — The UTF-8 text to write. It replaces the file entirely.
writeFile :: String -> String -> Effect Int
writeFile path contents =
  Wire.call "write_file" "fs" "writeFile" [ Wire.wire path, Wire.wire contents ]

-- | Replace the one exact occurrence of `oldString` in a file with `newString`.
-- |
-- | Widen the surrounding context until the match is unique rather than counting occurrences.
-- |
-- | # Arguments
-- |
-- | - `path` — The file to edit.
-- | - `oldString` — The exact text to find, including its whitespace. It must appear exactly once.
-- | - `newString` — The text to put in its place. An empty string deletes the match.
-- |
-- | # Raises
-- |
-- | `NotFound` when the text does not appear, and `Conflict` — with the number of matches — when it
-- | appears more than once.
editFile :: String -> String -> String -> Effect Unit
editFile path oldString newString =
  Wire.call_ "edit_file" "fs" "editFile"
    [ Wire.wire path, Wire.wire oldString, Wire.wire newString ]

-- | List a directory, sorted by name; `{}` lists your workspace.
-- |
-- | Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
-- | empty directory is an empty array, not a failure.
-- |
-- | # Arguments
-- |
-- | - `options` — Which directory to list; pass `{}` for your workspace root.
-- | - `options.path` — The directory to list, relative to your workspace or absolute.
listDir
  :: forall given rest
   . Union given rest ListDirOptions
  => Record given
  -> Effect (Array DirEntry)
listDir options =
  map dirEntry <$> Wire.call "list_dir" "fs" "listDir" [ Wire.pick "path" options ]
