"""BEFORE vs AFTER for the Python endpoint: how many queries and how long, for the same 5,000 students.
Run from the backend folder:   python scripts/measure_queries.py"""
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.db import QueryCounter, connect  # noqa: E402
from app.queries import list_students, list_students_one_query_per_row  # noqa: E402
from app.seed import seed_database  # noqa: E402


def measure(fn, path, runs=7):
    times, counts = [], set()
    for _ in range(runs):
        counter = QueryCounter()
        conn = connect(path, counter)
        t0 = time.perf_counter()
        fn(conn)
        times.append((time.perf_counter() - t0) * 1000)
        counts.add(counter.count)
        conn.close()
    return counts.pop(), statistics.median(times), max(times)


path = Path(tempfile.mkdtemp()) / "m.db"
seed_database(path)
for name, fn in (("before (one query per student)", list_students_one_query_per_row), ("after (one JOIN)", list_students)):
    queries, median_ms, worst_ms = measure(fn, path)
    print(f"{name:34} queries={queries:5}   median={median_ms:7.1f} ms   slowest={worst_ms:7.1f} ms   (7 runs)")
