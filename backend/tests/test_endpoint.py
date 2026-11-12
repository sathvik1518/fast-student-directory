import gzip
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import QueryCounter, connect, ensure_database
from app.main import create_app
from app.queries import list_students, list_students_one_query_per_row
from app.seed import BROKEN, CLASSES, STUDENT_COUNT, build_rows, seed_database


def test_endpoint_returns_5000_students_in_id_order(client):
    r = client.get("/api/students")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == STUDENT_COUNT == 5000
    assert [s["id"] for s in data] == list(range(1, 5001))
    assert set(data[0]) == {"id", "name", "class_name", "score"}


def test_one_request_runs_exactly_one_query(client):
    """The number the brief asks for: queries per request. Counted by the database connection itself."""
    assert client.get("/api/students").headers["x-query-count"] == "1"


def test_the_old_way_ran_one_query_per_student(db_path):
    counter = QueryCounter()
    conn = connect(db_path, counter)
    list_students_one_query_per_row(conn)
    assert counter.count == 5001


def test_the_fast_function_counts_as_one(db_path):
    counter = QueryCounter()
    conn = connect(db_path, counter)
    list_students(conn)
    assert counter.count == 1


def test_old_and_new_ways_give_the_same_answer(db_path):
    a, b = connect(db_path), connect(db_path)
    assert list_students(a) == list_students_one_query_per_row(b)


def test_the_counter_really_counts(db_path):
    counter = QueryCounter()
    conn = connect(db_path, counter)
    conn.execute("SELECT 1")
    conn.execute("SELECT 2")
    assert counter.count == 2


def test_server_timing_header_is_present_and_a_number(client):
    value = client.get("/api/students").headers["server-timing"]
    assert value.startswith("db;dur=") and float(value.split("=")[1]) >= 0


def test_response_is_gzipped_when_the_browser_accepts_it(db_path):
    app = create_app(db_path)
    with TestClient(app) as c:
        plain = c.get("/api/students", headers={"Accept-Encoding": "identity"})
        zipped = c.get("/api/students", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in plain.headers
    assert zipped.headers["content-encoding"] == "gzip"
    assert zipped.json() == plain.json()


def test_gzip_makes_the_wire_size_at_least_three_times_smaller(db_path):
    raw = json.dumps(TestClient(create_app(db_path)).get("/api/students").json(), separators=(",", ":")).encode()
    assert len(gzip.compress(raw)) * 3 < len(raw)


def test_the_four_broken_rows_are_returned_as_they_are(client):
    by_id = {s["id"]: s for s in client.get("/api/students").json()}
    assert by_id[7]["name"] is None
    assert by_id[1234]["score"] == "absent"
    assert by_id[3001]["class_name"] is None
    assert by_id[4500]["name"] == 12345


def test_exactly_the_documented_rows_are_broken(client):
    def broken(s):
        return not isinstance(s["name"], str) or not s["name"].strip() or isinstance(s["score"], bool) or not isinstance(s["score"], int) or not isinstance(s["class_name"], str)

    ids = [s["id"] for s in client.get("/api/students").json() if broken(s)]
    assert ids == sorted(BROKEN)


def test_all_other_rows_are_clean(client):
    data = client.get("/api/students").json()
    for s in data:
        if s["id"] in BROKEN:
            continue
        assert isinstance(s["name"], str) and " " in s["name"]
        assert isinstance(s["score"], int) and 20 <= s["score"] <= 100
        assert s["class_name"] in CLASSES


def test_there_are_15_classes_with_students_in_each(client):
    seen = {s["class_name"] for s in client.get("/api/students").json() if s["class_name"]}
    assert seen == set(CLASSES) and len(CLASSES) == 15


def test_seed_is_repeatable(tmp_path):
    a, b = tmp_path / "a.db", tmp_path / "b.db"
    seed_database(a), seed_database(b)
    assert list_students(connect(a)) == list_students(connect(b))
    assert build_rows() == build_rows()


def test_ensure_database_creates_the_file_once_and_keeps_it(tmp_path):
    path = tmp_path / "new.db"
    ensure_database(path)
    conn = sqlite3.connect(path)
    conn.execute("UPDATE students SET score = 1 WHERE id = 2")
    conn.commit(), conn.close()
    ensure_database(path)  # must not re-seed over existing data
    assert sqlite3.connect(path).execute("SELECT score FROM students WHERE id = 2").fetchone()[0] == 1


def test_no_half_built_file_is_left_behind(tmp_path):
    seed_database(tmp_path / "x.db")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["x.db"]


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_unknown_address_is_404_and_post_is_405(client):
    assert client.get("/api/nope").status_code == 404
    assert client.post("/api/students").status_code == 405


def test_two_requests_do_not_share_a_counter(client):
    assert client.get("/api/students").headers["x-query-count"] == "1"
    assert client.get("/api/students").headers["x-query-count"] == "1"  # not 2: each request has its own counter


def test_the_header_is_readable_by_a_page_on_another_port(client):
    assert "X-Query-Count" in client.get("/api/students").headers["access-control-expose-headers"]


def test_a_missing_class_still_returns_the_student(db_path):
    rows = list_students(connect(db_path))
    assert any(r["id"] == 3001 for r in rows) and len(rows) == 5000  # LEFT JOIN, not JOIN


def test_the_order_comes_from_the_query_not_from_luck():
    """In the real table the id is also the row number, so rows come back in id order even with no ORDER BY.
    Here the id is a plain column and the rows are stored out of order: only a real ORDER BY gives the right answer."""
    import sqlite3

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("CREATE TABLE classes (id INTEGER, name TEXT); CREATE TABLE students (id INTEGER, name, class_id INTEGER, score);")
    conn.execute("INSERT INTO classes VALUES (1, '6A')")
    conn.executemany("INSERT INTO students VALUES (?, ?, 1, 50)", [(3, "C"), (1, "A"), (2, "B")])
    assert [r["id"] for r in list_students(conn)] == [1, 2, 3]
