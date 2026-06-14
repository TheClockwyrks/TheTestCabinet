# The Test Cabinet

## Overview

The Test Cabinet is a benchmark for AI models and harnesses that uses a suite of
test cases inspired by old school arcade and flash games. These are used to
evaluate a model's coding and visual/spatial capabilities using test cases that
require significantly more code than most other commonly used software
development benchmarks.

Test cases in this repository intentionally do *not* attempt to create exact
copies of the games the tests are based on. This is both to avoid legal issues
around copyright, and as a way to ensure that models have to adapt to the
benchmarks. Adjustments to the original designs force models to follow the
specs provided for each test case, rather than exactly replicating the original
games that inspire each of the test cases. These modifications may also change
from one version of a benchmark to the next, reducing the impact of test case
contamination in training sets.
