"""The libraries a Python program may reach for, enumerated.

Read this first, because the mechanism is not the one a Python programmer expects
-----------------------------------------------------------------------------------

``componentize-py`` bakes **only the modules the app actually imports**. It imports this component's
entry module at build time and bundles the transitive closure of what that import pulled in;
anything outside the closure is not in the component's virtual filesystem at all, so a program that
writes ``import json`` gets ``ModuleNotFoundError`` no matter that CPython ships ``json``. A
function-local import does not count — the closure is measured by *executing* the import, not by
reading the source — which is why every name below is imported at module scope even though nothing
here uses one.

So this file is the answer to "which libraries does the Python arm offer?", and the answer is a
**bake-time fact about the committed artifact** rather than a policy enforced at run time. That is
worth more than it costs: a cross-language study can state exactly what each arm was given, and the
statement is checkable against the artifact rather than against a promise.

The two consequences, both good, one surprising:

* Everything listed here is already **imported** when a program starts, because the component's
  snapshot is taken after this module ran. A program's ``import json`` finds it in ``sys.modules``
  and costs nothing.
* Everything *not* listed is absent, and absent loudly. A model that reaches for a module that is
  not here gets Python's own ``ModuleNotFoundError`` naming it — an error it can act on — rather
  than a subtly degraded standard library.

What is deliberately left out
------------------------------

* **``asyncio``.** Nothing in this sandbox is asynchronous: the component's ``run`` export is
  synchronous, every gg call is synchronous, and there is no event loop to drive a coroutine to
  completion. Baking it in would offer a model a way to write a program whose second half never
  runs.
* **``subprocess`` and ``multiprocessing``.** A WASI component cannot spawn a process. Their absence
  is the honest signal; their presence would be an import that succeeds and a call that fails.
  ``shell.shell`` is how an agent runs a command, and it is a gg tool rather than a Python API.
* **``unittest`` and ``doctest``.** A program is one turn's worth of work, not a test suite, and
  both are large.
* **``ssl``, ``bz2``, ``lzma``, ``ctypes``, ``curses``.** Not available at all: they are C
  extensions ``componentize-py``'s CPython is not built with. ``ssl``'s absence is the one with a
  visible consequence — ``urllib.request`` reaches ``http://`` and not ``https://`` — and is
  recorded here rather than discovered by a model at run time.

Adding one is a one-line edit and a rebuild. It is not free: every module here is executed at bake
time and lands in the component's snapshot, so the list is curated rather than exhaustive.
"""

# --- Data, text and encoding ------------------------------------------------------------------
import base64
import binascii
import codecs
import configparser
import copy
import csv
import difflib
import hashlib
import hmac
import html
import json
import pickle
import pprint
import re
import reprlib
import secrets
import shlex
import string
import struct
import textwrap
import tomllib
import unicodedata
import uuid

# --- Numbers ----------------------------------------------------------------------------------
import cmath
import decimal
import fractions
import math
import numbers
import random
import statistics

# --- Structures, functional programming and the type system -----------------------------------
import abc
import array
import bisect
import collections
import collections.abc
import contextlib
import dataclasses
import enum
import functools
import graphlib
import heapq
import itertools
import operator
import queue
import types
import typing
import weakref

# --- Time -------------------------------------------------------------------------------------
import calendar
import datetime
import time
import zoneinfo

# --- Files, archives and the operating system --------------------------------------------------
import filecmp
import fnmatch
import glob
import gzip
import io
import mimetypes
import os
import os.path
import pathlib
import shutil
import sqlite3
import stat
import tarfile
import tempfile
import zipfile
import zlib

# --- The network ------------------------------------------------------------------------------
import email
import email.message
import email.parser
import http.client
import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree

# --- Introspection, diagnostics and the interpreter ---------------------------------------------
import argparse
import ast
import dis
import inspect
import keyword
import logging
import platform
import sys
import threading
import tokenize
import traceback
import warnings

# --- Curated third-party libraries ---------------------------------------------------------------
# Pure-Python wheels installed by `build.sh` from `requirements.txt`, which is where the pins live
# and why each is here. Kept deliberately short: the standard library above already covers most of
# what a program that reads and writes a workspace needs, and every addition is bytes in an artifact
# that is committed to the repository.
import tomli_w
import yaml

#: Every module this component was baked with, sorted — the artifact's own answer to "what was this
#: arm offered?".
#:
#: Derived from what really landed in ``sys.modules`` rather than from a second hand-written list,
#: so it cannot drift from the imports above. Top-level names only: a program that has ``email`` has
#: ``email.parser``, and listing both would say nothing extra.
MODULES = sorted(
    {
        name.split(".", 1)[0]
        for name in sys.modules
        if not name.startswith("_") and name not in {"shim", "library", "wit_world"}
    }
)
