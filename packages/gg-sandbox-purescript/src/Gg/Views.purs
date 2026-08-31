-- | The only way material enters the context window.
-- |
-- | Each view is one message, carrying the band it is charged to and the selector it is filed under.
module Gg.Views
  ( openFile
  , openText
  , openDocsView
  , close
  , OpenFileOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Effect (Effect)
import Gg.Files (FileRead(..))
import Gg.Internal.Read (fileRead)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The window of lines a file view shows, and how long a line of it may run. Every field is
-- | optional; `{}` shows the whole file with its lines whole.
type OpenFileOptions = (offset :: Int, limit :: Int, maxLineChars :: Int)

-- | Read a file and place it in the context window, keyed by its path.
-- |
-- | The file becomes its own context item, attributed to its path and filed under it. `offset` and
-- | `limit` select a window of lines, and two pages of one file are two views that coexist;
-- | re-opening the same page replaces what it showed. An image file is displayed as a picture, and
-- | this is the only call that displays one.
-- |
-- | A text view's body is held to a 65,536-byte cap: a window that would carry more is refused with
-- | its size and the bound, and nothing is opened and nothing is truncated. `maxLineChars` cuts each
-- | line of the view longer than that many characters at that point and annotates it in place as
-- | `foo (123 more chars...)`; left out, lines arrive whole. The cut is the view's alone — the value
-- | this call hands back and the file itself are untouched — and the cap is measured against the
-- | body after it.
-- |
-- | # Operation
-- |
-- | views.open_file
-- |
-- | # Arguments
-- |
-- | - `path` — The file to open, relative to the workspace or absolute.
-- | - `options` — The window of lines to show, and how long a line of it may run; `{}` shows the
-- |   whole file with its lines whole.
-- | - `options.offset` — The 1-based line to start at.
-- | - `options.limit` — How many lines to show from `offset`.
-- | - `options.maxLineChars` — The most characters a line of the view may run to, from 1 to 65536;
-- |   a longer line is cut there and annotated in place as `(N more chars...)`. Left out, lines
-- |   arrive whole, and neither the returned contents nor the file is cut.
-- |
-- | # Returns
-- |
-- | The `TextFile` arm for a text file's window, or the `ImageFile` arm describing a picture whose
-- | bytes never entered the program.
-- |
-- | # Throws
-- |
-- | `LimitExceeded`, naming the size and the bound, for a text view whose body — after any cut —
-- | would exceed 65,536 bytes; nothing is opened. `InvalidArgument` for a `maxLineChars` of zero or
-- | above 65,536, and `NotFound` for a missing path.
openFile
  :: forall given rest
   . Union given rest OpenFileOptions
  => String
  -> Record given
  -> Effect FileRead
openFile path options =
  -- `read_file`, not `open_file`: the operation argument is the GATE, and showing a file is a read
  -- gg also puts in the window, so it is `read_file` being withheld that this call refuses under.
  Wire.callMap (fileRead TextFile ImageFile) "read_file" "views" "Gg.Views.openFile"
    [ Wire.wire path, Wire.lower {} options ]

-- | Place a value the program computed in the context window, under a label.
-- |
-- | A directory listing, a command's output, a child agent's answer, an assembled table. Opening the
-- | same label again replaces what it showed. An empty body is allowed.
-- |
-- | # Operation
-- |
-- | views.open_text
-- |
-- | # Arguments
-- |
-- | - `label` — What to file the view under. It is the view's selector, and opening the same label
-- |   again replaces what it showed. It may not be empty.
-- | - `body` — What to show. It may be empty.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty label, and `LimitExceeded`, naming the cap, for a body over
-- | 65,536 bytes or a label over gg's cap. Nothing is truncated.
openText :: String -> String -> Effect Unit
openText label body =
  Wire.call_ "open_text" "views" "Gg.Views.openText" [ Wire.wire label, Wire.wire body ]

-- | Place one module's, function's or type's full documentation in the context window.
-- |
-- | Everything filed under it: its signature, its description, and the declarations of any types it
-- | refers to that have not already been shown this session. It is a view rather than a return
-- | value, so the documentation arrives in the next prompt under a `Documentation` heading keyed by
-- | the entry's name and is not available in the turn that opened it. Opening an entry that is
-- | already open does nothing.
-- |
-- | # Operation
-- |
-- | views.open_docs_view
-- |
-- | # Arguments
-- |
-- | - `name` — The entry to document, by its fully-qualified name — `"Gg.Views.openText"` — or, for
-- |   a module, that module's own path — `"Gg.Views"`.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown or unbound name.
openDocsView :: String -> Effect Unit
openDocsView name = Wire.call_ "open_docs_view" "views" "Gg.Views.openDocsView" [ Wire.wire name ]

-- | Close every view carrying a selector, freeing the tokens they occupied.
-- |
-- | Closing a file view forgets what was read rather than what exists; closing a text view discards
-- | the only copy of what it held. Documentation views are not reached from here.
-- |
-- | # Operation
-- |
-- | views.close
-- |
-- | # Arguments
-- |
-- | - `selector` — What the view is filed under: a file's path, a text view's label, or
-- |   `search results`.
-- |
-- | # Returns
-- |
-- | How many views were closed: for a file that is every page of that path, for a text view the one
-- | with that label, for the results of a search the label `search results`. A selector that is not
-- | open hands back `0` rather than failing.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty selector, which names nothing rather than everything.
-- | `Unavailable` under a run that did not enable `agent-managed-context`.
close :: String -> Effect Int
close selector = Wire.call "close" "views" "Gg.Views.close" [ Wire.wire selector ]
