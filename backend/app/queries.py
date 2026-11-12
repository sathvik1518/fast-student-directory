"""The two ways to get the student list. The endpoint uses ONLY the fast one.
The slow one is kept so the before/after numbers can be reproduced (scripts/measure_queries.py and the tests)."""
from __future__ import annotations

import sqlite3


def _to_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "class_name": row["class_name"], "score": row["score"]}


def list_students(conn: sqlite3.Connection) -> list[dict]:
    """AFTER: one query. The database joins the class name in itself.
    LEFT JOIN, not JOIN: a student whose class is missing is still returned (the page decides what to do with it)."""
    rows = conn.execute(
        "SELECT s.id, s.name, c.name AS class_name, s.score "
        "FROM students s LEFT JOIN classes c ON c.id = s.class_id "
        "ORDER BY s.id"
    ).fetchall()
    return [_to_dict(r) for r in rows]


def list_students_one_query_per_row(conn: sqlite3.Connection) -> list[dict]:
    """BEFORE: the 'N + 1' mistake. One query for the students, then one more per student to look up the class name.
    5,000 students = 5,001 queries."""
    students = conn.execute("SELECT id, name, class_id, score FROM students ORDER BY id").fetchall()
    result = []
    for s in students:
        row = conn.execute("SELECT name FROM classes WHERE id = ?", (s["class_id"],)).fetchone()
        result.append({"id": s["id"], "name": s["name"], "class_name": row["name"] if row else None, "score": s["score"]})
    return result
