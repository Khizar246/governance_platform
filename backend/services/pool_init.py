"""Worker-process initializer for the analysis pool.

MUST stay free of polars/pandas imports (directly or transitively): it is
unpickled and executed in each spawned worker before any task runs, and
POLARS_MAX_THREADS only takes effect if set before polars is first imported
in that process.
"""

import os


def worker_init(polars_threads: int) -> None:
    os.environ["POLARS_MAX_THREADS"] = str(polars_threads)
