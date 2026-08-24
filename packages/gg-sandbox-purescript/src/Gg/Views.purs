-- | The only way material enters the agent's own context window.
-- |
-- | Under responses as code a whole program's output would otherwise collapse into one anonymous blob
-- | of logs, charged to one band and attributable to nothing. A view restores what tool calling gave
-- | for free: one message per view, carrying the band it is charged to and the selector it is filed
-- | under.
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
-- | The file becomes its own context item, attributed to its path and filed under it. The split from
-- | `Gg.Files.readFile` is the point: that call gets bytes for the program, this one puts a file in
-- | front of the model, so a program that reads forty files to grep them still costs no window.
-- |
-- | `offset` and `limit` select a window of lines, and two pages of one file are two views that
-- | coexist; re-opening the same page replaces what it showed rather than piling up a duplicate. An
-- | image file is displayed as a picture, and this is the only call that displays one — reading an
-- | image describes it without showing it.
-- |
-- | A text view is held to the same 65,536-byte cap a `Gg.Views.openText` body is: a window that
-- | would carry more is refused with its size and the bound, and nothing is opened and nothing is
-- | silently truncated. `maxLineChars` is for the file whose lines are the problem rather than its
-- | length — a minified bundle, a log of enormous lines. Set, it cuts each line of the **view**
-- | longer than that many characters at that point and annotates it in place as
-- | `foo (123 more chars...)`; left out, lines arrive whole. The cut is the view's alone — the value
-- | this call hands back and the file itself are untouched — and the cap is measured against the
-- | body after it, which is what lets a window over such a file fit.
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
-- |   arrive whole, and neither the returned contents nor the file is ever cut.
-- |
-- | # Returns
-- |
-- | Exactly what `Gg.Files.readFile` hands back for the same file, so the program holds the
-- | contents as well as the model holding the view.
-- |
-- | # Throws
-- |
-- | `LimitExceeded`, naming the size and the bound, for a text view whose body — after any cut —
-- | would exceed 65,536 bytes; nothing is opened, and the way out is a narrower window through
-- | `offset` and `limit`, or shorter lines through `maxLineChars`. `InvalidArgument` for a
-- | `maxLineChars` of zero or above 65,536, and `NotFound` for a missing path.
openFile
  :: forall given rest
   . Union given rest OpenFileOptions
  => String
  -> Record given
  -> Effect FileRead
openFile path options =
  fileRead TextFile ImageFile
    -- `read_file`, not `open_file`: the first argument is the GATE, and showing a file is a read gg
    -- also puts in the window, so it is `read_file` being withheld that this call refuses under.
    <$> Wire.call "read_file" "views" "Gg.Views.openFile" [ Wire.wire path, Wire.lower {} options ]

-- | Place a value the program computed in the context window, under a label.
-- |
-- | A directory listing, a command's output, a child agent's answer, an assembled table: this is the
-- | channel into the window, and a value a program computes reaches the model on no other. Opening
-- | the same label again replaces what it showed, so a program may refine a view in a loop without
-- | piling up a copy per iteration. An empty body is allowed, since it is how a program says that
-- | something it was showing is now empty.
-- |
-- | # Operation
-- |
-- | views.open_text
-- |
-- | # Arguments
-- |
-- | - `label` — What to file the view under. It is the view's selector, and opening the same label
-- |   again replaces what it showed. It may not be empty.
-- | - `body` — What to show. An empty body is allowed: it is how a program says that something it was
-- |   showing is now empty.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty label — a view with no selector could never be attributed or
-- | replaced — and `LimitExceeded`, naming the cap, for a body over 65,536 bytes or a label over
-- | gg's cap; nothing is ever silently truncated.
openText :: String -> String -> Effect Unit
openText label body =
  Wire.call_ "open_text" "views" "Gg.Views.openText" [ Wire.wire label, Wire.wire body ]

-- | Place one module's, function's or type's full documentation in the context window.
-- |
-- | Everything filed under it — its signature, its description, and the declarations of any types it
-- | refers to that have not already been shown this session. This is a **view** rather than a return
-- | value: the documentation arrives in the next prompt under a `Documentation` heading keyed by the
-- | entry's name, exactly as a file or a computed value arrives, so it is not available in the turn
-- | that asks for it. Asking in one turn and using it in the next is the shape that works. Opening an
-- | entry that is already open does nothing at all — not a move, not a second copy — since the
-- | documentation band only grows.
-- |
-- | # Operation
-- |
-- | views.open_docs_view
-- |
-- | # Arguments
-- |
-- | - `name` — The entry to document, by its fully-qualified name — `"Gg.Views.openText"` — or, for
-- |   a module, that module's own path — `"Gg.Views"`. Searching the documentation is what names the
-- |   entries that exist, and anything a search returns can be opened.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown or unbound name.
openDocsView :: String -> Effect Unit
openDocsView name = Wire.call_ "open_docs_view" "views" "Gg.Views.openDocsView" [ Wire.wire name ]

-- | Close every view carrying a selector, freeing the tokens they occupied.
-- |
-- | Closing a file view forgets what was read rather than what exists; closing a text view discards
-- | the only copy of what it held, so anything needed later belongs in a file or a memory first.
-- |
-- | Documentation views are not reached from here: taking one away is bought by a capability of its
-- | own, `docview-close`, so a sweep that included them would hand back `0` for an agent that may
-- | not close one, which reads as a selector that named nothing.
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
-- | open hands back `0` rather than failing, so a program that tidies up unconditionally needs no
-- | guard on every call.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty selector, which names nothing rather than everything — no call
-- | here closes the window wholesale. `Unavailable` for an agent whose run did not buy
-- | `agent-managed-context`, the capability that buys closing a view.
close :: String -> Effect Int
close selector = Wire.call "close" "views" "Gg.Views.close" [ Wire.wire selector ]
