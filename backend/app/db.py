from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from app.seed import seed_database

DEFAULT_PATH = Path(os.environ.get("STUDENTS_DB", Path(__file__).resolve().parent.parent / "students.db"))


class QueryCounter:
    """Counts every SQL statement run on one connection. This is how 'how many queries for one request?' gets a real number."""

    def __init__(self) -> None:
        self.count = 0

    def __call__(self, _statement: str) -> None:
        self.count += 1


def ensure_database(path: str | Path = DEFAULT_PATH) -> Path:
    path = Path(path)
    if not path.exists():
        seed_database(path)
    return path


def connect(path: str | Path, counter: QueryCounter | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    if counter is not None:
        conn.set_trace_callback(counter)
    return conn
