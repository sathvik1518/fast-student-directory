"""Makes the same 5,000 students every time (a fixed random seed), so every measurement is repeatable.
Four records are broken ON PURPOSE, like rows left behind by an old import. The page must survive them."""
from __future__ import annotations

import random
import sqlite3
from pathlib import Path

STUDENT_COUNT = 5000
CLASSES = [f"{grade}{section}" for grade in range(6, 11) for section in "ABC"]  # 6A ... 10C = 15 classes

# id -> what is wrong with that row (the page has to cope with each one)
BROKEN = {
    7: "name is missing (NULL)",
    1234: "score is text, not a number",
    3001: "class does not exist (class_id 99)",
    4500: "name is a number, not text",
}

FIRST = ["Aarav", "Vivaan", "Aditya", "Sai", "Arjun", "Krishna", "Rohan", "Karthik", "Harsha", "Nikhil", "Rahul", "Varun", "Teja", "Charan", "Pranav",
         "Ananya", "Diya", "Meera", "Sneha", "Lakshmi", "Pooja", "Divya", "Keerthi", "Anjali", "Priya", "Bhavana", "Harini", "Sirisha", "Navya", "Isha"]
LAST = ["Reddy", "Goud", "Rao", "Sharma", "Naidu", "Patel", "Kumar", "Verma", "Yadav", "Chowdary", "Varma", "Gupta", "Singh", "Mehta", "Nair",
        "Iyer", "Joshi", "Das", "Pillai", "Menon", "Bhat", "Kulkarni", "Shetty", "Jain", "Thakur"]

SCHEMA = """
CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE students (id INTEGER PRIMARY KEY, name, class_id INTEGER, score);
CREATE INDEX students_class ON students(class_id);
"""


def build_rows(count: int = STUDENT_COUNT) -> list[tuple]:
    rng = random.Random(47)
    rows = []
    for student_id in range(1, count + 1):
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        class_id = rng.randint(1, len(CLASSES))
        score = rng.randint(20, 100)
        rows.append((student_id, name, class_id, score))
    if count >= max(BROKEN):
        by_id = {r[0]: i for i, r in enumerate(rows)}
        rows[by_id[7]] = (7, None, rows[by_id[7]][2], rows[by_id[7]][3])
        rows[by_id[1234]] = (1234, rows[by_id[1234]][1], rows[by_id[1234]][2], "absent")
        rows[by_id[3001]] = (3001, rows[by_id[3001]][1], 99, rows[by_id[3001]][3])
        rows[by_id[4500]] = (4500, 12345, rows[by_id[4500]][2], rows[by_id[4500]][3])
    return rows


def seed_database(path: str | Path, count: int = STUDENT_COUNT) -> None:
    tmp = Path(str(path) + ".building")
    tmp.unlink(missing_ok=True)
    conn = sqlite3.connect(tmp)
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO classes (id, name) VALUES (?, ?)", list(enumerate(CLASSES, start=1)))
    conn.executemany("INSERT INTO students (id, name, class_id, score) VALUES (?, ?, ?, ?)", build_rows(count))
    conn.commit()
    conn.close()
    tmp.replace(path)  # appears all at once: a half-built file is never seen
