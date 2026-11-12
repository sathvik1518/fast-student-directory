# A Fast and Safe Student Directory: One Query, 5,000 Rows Without 5,000 Elements, and a Broken Record That Costs One Row

**Day 47 Mini Capstone, A Fast and Safe Student Directory (Performance)**  
**Project folder:** `fast-student-directory`

---

## 1. Goal

Build a student directory that shows **5,000 students** and stays fast and safe. The task asked for a page that:

1. loads the list from a server, with **one database query** instead of one per student;
2. can **search, filter by class and sort**, and still feels instant while typing;
3. **survives bad data**: four records are broken on purpose, and one broken record must not break the page;
4. draws its filter form from **checked settings**, not from hand-written fields;
5. has a **written meaning of "slow"** before any measuring, and **before/after numbers** against it.

Think of a long paper register. The slow way copies **every** name onto the notice board, and rewrites the whole board each time someone types a letter. The fast way pins up only the **20 names you can see through the window**, and slides the register past it when you scroll. The notice board looks like one long list, but only a small part of it is real. A broken record is one torn page: it gets a note saying "page torn", and the other pages still work.

**What is real and what is not.** Python server, SQLite file with 5,000 students (fixed random seed, so every run is the same), React page built and served, and a real Chromium browser with the CPU slowed 4 times. All numbers in this document were measured in a Linux sandbox. Windows was **not** tested. See *Known limit*.

---

## 2. Tools

| Tool | Role |
|---|---|
| Python 3.10+ (tested on 3.13) | Server |
| FastAPI 0.162.0, uvicorn 0.54.0 | The `/api/students` endpoint (gzip, query count and timing headers) |
| SQLite (built in) | 5,000 students, 15 classes, 4 broken rows |
| React 19 + TypeScript (strict) | The page |
| Vite | Dev server, build, and `preview` with a proxy to Python (same address, no CORS) |
| @tanstack/react-virtual 3 | Virtual list: only the visible rows exist |
| Zod 4 | Checks the filter-field settings and the values typed into the form |
| pytest 9.1.1 + httpx | Server tests |
| vitest 5 + React Testing Library + user-event + jsdom | Page tests (200) |
| Playwright 1.63 (Chromium) | Real-browser check and speed measurements (CPU throttled 4x) |

---

## 3. Project structure

```
fast-student-directory/
├── SLOW_DEFINITION.md             (what "slow" means, written before measuring)
├── break47.py                     (65 deliberate mistakes; tests must notice each)
├── backend/
│   ├── app/ seed.py db.py queries.py main.py
│   ├── tests/ conftest.py test_endpoint.py        (22 tests)
│   └── scripts/measure_queries.py                 (5,001 queries vs 1)
└── frontend/
    ├── src/api/        students.ts types.ts
    ├── src/directory/  Directory, FilterForm, StudentCard, StudentRow, ErrorBoundary, records, filtering, fieldSchema, useStudents, filter-fields.json
    ├── src/directory/lists/  PlainList (before), MemoList (trap + fix), VirtualList (after)
    ├── src/test/       setup.ts fixtures.ts
    ├── scripts/        check-browser.mjs measure.mjs lib.mjs
    └── perf/last-run.md                           (written by `npm run measure`)
```

---

## 4. Setup commands

```bash
# Windows PowerShell. Two windows: server and page.
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
# in a second window:
cd frontend
npm install
npx playwright install chromium     # only for check:browser and measure
```

**Commands**

```bash
# backend folder
python -m pytest -q                                      # 22 tests
python -m uvicorn app.main:create_app --factory --port 8000
python scripts/measure_queries.py                        # 5001 queries vs 1
# frontend folder
npm test                                                 # 200 tests
npm run dev                                              # http://localhost:5173
npm run build
npm run check:browser                                    # real browser, starts both servers itself
npm run measure                                          # speed table, writes perf/last-run.md
# project folder
python break47.py                                        # 65 deliberate mistakes
```

---

## 5. The idea: measure first, fix the cause, keep the safety

**Five ways to draw the same list** (open the page with `?list=...` to repeat the measurements):

| `?list=` | What it is |
|---|---|
| `plain` | BEFORE: every matching row on the page |
| `memo-inline` | `memo` added, but a **new function is passed every time**, so memo never skips anything (the trap) |
| `memo` | the fix: the same function every time (`useCallback`) |
| `virtual` | AFTER: only visible rows exist (default) |
| `virtual-deferred` | virtual + `useDeferredValue` on the filter |

**What the numbers say** (5,000 students, CPU slowed 4x, median of 3 runs):

| | Page ready | Elements | Worst letter | Click a row | Rows redrawn by a click |
|---|---|---|---|---|---|
| plain | 2117 ms | 25,037 | 268 ms | 577 ms | 5,568 |
| memo-inline | 2290 ms | 25,037 | 268 ms | 650 ms | 5,627 |
| memo | 2156 ms | 25,037 | 202 ms | 524 ms | 1 |
| virtual | 761 ms | 122 | 35 ms | 18 ms | 1 |
| virtual-deferred | 701 ms | 122 | 33 ms | 17 ms | 1 |

Three honest readings: (1) **`memo` fixed React's work (1 row instead of 5,568) but the click still took 524 ms**, because the browser still has 25,000 elements to lay out. Only removing elements fixed that. (2) The memo trap is real: `memo-inline` is no better than `plain`. (3) `useDeferredValue` gave **no meaningful gain** here: the virtual list is already fast. I kept it only as something to measure, not as a recommendation.

**Server:** the old way ran **5,001 queries (27.9 ms)**; one `LEFT JOIN` runs **1 query (4.9 ms)**. The endpoint reports its own count in an `X-Query-Count` header and a test fails if it is not 1. The 313 KB list travels as **41 KB** with gzip.

**Broken records.** Four rows are broken on purpose: #7 no name, #1234 score "absent", #3001 class that does not exist, #4500 name is a number. Each row has its **own error boundary**, so a broken row shows "Record #7 can't be shown: the name is missing." and the other 4,999 work. Rows that are not even objects (`null`, text) become broken rows too. A boundary catches errors made **while drawing**; it does not catch errors in click handlers, so none are relied on for that.

---

## 6. The code

### `backend/app/seed.py`

```python
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
```

### `backend/app/db.py`

```python
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
```

### `backend/app/queries.py` (the slow way and the fast way, side by side)

```python
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
```

### `backend/app/main.py`

```python
from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.gzip import GZipMiddleware

from app.db import DEFAULT_PATH, QueryCounter, connect, ensure_database
from app.queries import list_students


def create_app(db_path: str | Path | None = None) -> FastAPI:
    path = ensure_database(db_path or DEFAULT_PATH)
    app = FastAPI(title="Student Directory API")
    # Compression: the list is repeated text, so gzip makes it several times smaller on the wire.
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/students")
    def students(response: Response) -> list[dict]:
        counter = QueryCounter()
        started = time.perf_counter()
        conn = connect(path, counter)
        try:
            rows = list_students(conn)
        finally:
            conn.close()
        response.headers["X-Query-Count"] = str(counter.count)
        response.headers["Server-Timing"] = f"db;dur={(time.perf_counter() - started) * 1000:.1f}"
        response.headers["Access-Control-Expose-Headers"] = "X-Query-Count, Server-Timing"
        # Plain dicts, no response model on purpose: the rows are returned as they are in the database,
        # including the 4 broken legacy rows. The page, not the API, decides how to show a broken row.
        return rows

    return app
```

### `backend/requirements.txt`

```text
fastapi==0.162.0
uvicorn==0.54.0
```

### `backend/requirements-dev.txt`

```text
-r requirements.txt
pytest==9.1.1
httpx==0.28.1
```

### `backend/pytest.ini`

```ini
[pytest]
pythonpath = .
testpaths = tests
```

### `backend/scripts/measure_queries.py`

```python
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
```

### `frontend/package.json`

```json
{
  "name": "fast-student-directory-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check:browser": "node scripts/check-browser.mjs",
    "measure": "node scripts/measure.mjs"
  },
  "dependencies": {
    "@tanstack/react-virtual": "^3.14.26",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.2.1",
    "jsdom": "^31.0.0",
    "playwright": "^1.63.0",
    "typescript": "^7.0.2",
    "vite": "^8.3.6",
    "vitest": "^5.1.0"
  }
}
```

### `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

### `frontend/vite.config.ts`

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The page asks /api/... on its own address; this proxy forwards it to the Python server. Same origin, so no CORS.
const api = { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: api },
  preview: { port: 4173, strictPort: true, proxy: api },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

### `frontend/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>Student Directory</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `frontend/src/api/types.ts`

```ts
/** What the Python endpoint may send for one student. It is typed as honestly as possible: the 4 legacy rows prove that
 *  `name` can be missing or a number, `score` can be text, and `class_name` can be missing. */
export type RawStudent = {
  id: number;
  name: string | number | null;
  class_name: string | null;
  score: number | string | null;
};

export type StudentsResult = {
  students: RawStudent[];
  /** How many database queries the server ran for this one request (from the X-Query-Count header), or null if not sent. */
  queryCount: number | null;
};

export type Fetcher = (signal?: AbortSignal) => Promise<StudentsResult>;
```

### `frontend/src/api/students.ts`

```ts
import type { RawStudent, StudentsResult } from "./types";

/** Reads the list from the Python endpoint. Throws an Error with a message a person can read. */
export async function fetchStudents(signal?: AbortSignal): Promise<StudentsResult> {
  let response: Response;
  try {
    response = await fetch("/api/students", { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Cannot reach the server. Is it running?");
  }
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server sent something that is not a student list.");
  }
  if (!Array.isArray(body)) throw new Error("The server sent something that is not a student list.");
  const header = response.headers.get("X-Query-Count");
  const queryCount = header !== null && /^\d+$/.test(header) ? Number(header) : null;
  // Each ROW is checked later, one by one, so one broken row can never hide the other 4,999.
  return { students: body as RawStudent[], queryCount };
}
```

### `frontend/src/perf/counters.ts`

```ts
/** Counts how many times parts of the page render. Used to measure speed changes. One integer add: free.
 *  Add ?perf to the address to read the numbers in the console:  window.__perf.get() */
const counts: Record<string, number> = {};

export function bump(name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

export function resetCounts(): void {
  for (const key of Object.keys(counts)) delete counts[key];
}

export function getCounts(): Record<string, number> {
  return { ...counts };
}

declare global {
  interface Window {
    __perf?: { get: () => Record<string, number>; reset: () => void };
  }
}

if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf")) {
  window.__perf = { get: getCounts, reset: resetCounts };
}
```

### `frontend/src/directory/records.ts`

```ts
import type { RawStudent } from "../api/types";

/** A student the page can safely show. */
export type Student = { id: number; name: string; className: string; score: number };

export class BrokenRecordError extends Error {
  readonly studentId: number;
  readonly problem: string;
  constructor(studentId: number, problem: string) {
    super(`Student #${studentId}: ${problem}`);
    this.name = "BrokenRecordError";
    this.studentId = studentId;
    this.problem = problem;
  }
}

/** The first thing wrong with a row, in plain words, or null if the row is fine. */
export function describeProblem(raw: RawStudent): string | null {
  if (raw.name === null || raw.name === undefined) return "the name is missing";
  if (typeof raw.name !== "string") return "the name is not text";
  if (raw.name.trim() === "") return "the name is empty";
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) return "the score is not a number";
  if (typeof raw.class_name !== "string" || raw.class_name.trim() === "") return "the class is missing";
  return null;
}

/** Turns a row into a safe Student, or throws BrokenRecordError. Rendering calls this, so a bad row throws INSIDE its own error boundary. */
export function readStudent(raw: RawStudent): Student {
  const problem = describeProblem(raw);
  if (problem !== null) throw new BrokenRecordError(raw.id, problem);
  return { id: raw.id, name: raw.name as string, className: raw.class_name as string, score: raw.score as number };
}

/** A row plus the answers that never change, worked out ONCE when the list loads (not on every keystroke). */
export type IndexedStudent = {
  raw: RawStudent;
  /** lower-case name for searching; "" for a row with no readable name */
  nameKey: string;
  /** the score as a number, or null when it is not one (sorts last) */
  scoreValue: number | null;
  problem: string | null;
};

/** A row that is not even an object (null, a number, text) cannot be read at all. It becomes a row that is reported as broken,
 *  with a negative number so it cannot clash with a real student number. One bad entry never stops the other 4,999. */
function asRow(row: unknown, position: number): RawStudent {
  if (typeof row === "object" && row !== null && !Array.isArray(row)) return row as RawStudent;
  return { id: -(position + 1), name: null, class_name: null, score: null };
}

export function indexStudents(rows: readonly unknown[]): IndexedStudent[] {
  return rows.map(asRow).map((raw) => ({
    raw,
    nameKey: typeof raw.name === "string" ? raw.name.toLowerCase() : "",
    scoreValue: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
    problem: describeProblem(raw),
  }));
}

export function scoreBand(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  return "Needs support";
}
```

### `frontend/src/directory/filter-fields.json`

```json
[
  { "name": "query", "type": "text", "label": "Search by name", "placeholder": "Type a name", "maxLength": 50 },
  {
    "name": "className",
    "type": "select",
    "label": "Class",
    "options": [
      { "value": "", "label": "All classes" },
      { "value": "6A", "label": "Class 6A" }, { "value": "6B", "label": "Class 6B" }, { "value": "6C", "label": "Class 6C" },
      { "value": "7A", "label": "Class 7A" }, { "value": "7B", "label": "Class 7B" }, { "value": "7C", "label": "Class 7C" },
      { "value": "8A", "label": "Class 8A" }, { "value": "8B", "label": "Class 8B" }, { "value": "8C", "label": "Class 8C" },
      { "value": "9A", "label": "Class 9A" }, { "value": "9B", "label": "Class 9B" }, { "value": "9C", "label": "Class 9C" },
      { "value": "10A", "label": "Class 10A" }, { "value": "10B", "label": "Class 10B" }, { "value": "10C", "label": "Class 10C" }
    ]
  },
  {
    "name": "sort",
    "type": "select",
    "label": "Sort by score",
    "options": [
      { "value": "none", "label": "Default order" },
      { "value": "desc", "label": "High to low" },
      { "value": "asc", "label": "Low to high" }
    ]
  },
  { "name": "problemsOnly", "type": "checkbox", "label": "Show only broken records" }
]
```

### `frontend/src/directory/fieldSchema.ts`

```ts
import { z } from "zod";

/** The filter form is DRAWN from a list of field settings (filter-fields.json). A list written by hand can be wrong,
 *  so it is checked here before anything is drawn from it. */
const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "must start with a letter and use only letters and digits");
const label = z.string().trim().min(1, "must not be empty");

const textField = z.strictObject({
  name: fieldName,
  label,
  type: z.literal("text"),
  placeholder: z.string().optional(),
  maxLength: z.number().int().min(1).max(200),
});

const selectField = z
  .strictObject({
    name: fieldName,
    label,
    type: z.literal("select"),
    options: z.array(z.strictObject({ value: z.string(), label })).min(2, "needs at least 2 options"),
  })
  .refine((f) => new Set(f.options.map((o) => o.value)).size === f.options.length, {
    message: "option values must all be different",
    path: ["options"],
  });

const checkboxField = z.strictObject({ name: fieldName, label, type: z.literal("checkbox") });

export const fieldSettingsSchema = z
  .array(z.discriminatedUnion("type", [textField, selectField, checkboxField]))
  .min(1, "needs at least one field")
  .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, { message: "field names must all be different" });

export type FieldSetting = z.infer<typeof fieldSettingsSchema>[number];
export type Values = Record<string, string | boolean>;

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "settings";
  return "settings" + path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
}

export type SettingsResult = { ok: true; fields: FieldSetting[] } | { ok: false; problems: string[] };

/** Checks the settings list. Never throws: a bad list gives a list of plain-words problems instead. */
export function parseFieldSettings(input: unknown): SettingsResult {
  const result = fieldSettingsSchema.safeParse(input);
  if (result.success) return { ok: true, fields: result.data };
  return { ok: false, problems: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`) };
}

export function defaultValues(fields: readonly FieldSetting[]): Values {
  const values: Values = {};
  for (const field of fields) {
    values[field.name] = field.type === "text" ? "" : field.type === "checkbox" ? false : (field.options[0]?.value ?? "");
  }
  return values;
}

/** The rules for what a person may enter, built from the same settings that draw the form. */
export function buildValuesSchema(fields: readonly FieldSetting[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (field.type === "text") shape[field.name] = z.string().max(field.maxLength, `at most ${field.maxLength} characters`);
    else if (field.type === "checkbox") shape[field.name] = z.boolean();
    else shape[field.name] = z.enum(field.options.map((o) => o.value) as [string, ...string[]], { error: "choose one of the listed options" });
  }
  return z.strictObject(shape);
}

export type ValuesResult = { ok: true; values: Values } | { ok: false; field: string; message: string };

/** Checks values before they are used. On a problem it names the field and says what is wrong. */
export function parseValues(fields: readonly FieldSetting[], input: unknown): ValuesResult {
  const result = buildValuesSchema(fields).safeParse(input);
  if (result.success) return { ok: true, values: result.data as Values };
  const issue = result.error.issues[0];
  const fieldName = String(issue?.path[0] ?? "");
  const found = fields.find((f) => f.name === fieldName);
  return { ok: false, field: fieldName, message: `${found?.label ?? "Form"}: ${issue?.message ?? "not valid"}` };
}
```

### `frontend/src/directory/filtering.ts`

```ts
import type { IndexedStudent } from "./records";
import type { Values } from "./fieldSchema";

export type SortOrder = "none" | "asc" | "desc";
export type Filter = { query: string; className: string; sort: SortOrder; problemsOnly: boolean };

export const NO_FILTER: Filter = { query: "", className: "", sort: "none", problemsOnly: false };

/** Form values (checked already) -> the Filter the list understands. Anything unexpected falls back to 'no filter'. */
export function filterFromValues(values: Values): Filter {
  const { query, className, sort, problemsOnly } = values;
  return {
    query: typeof query === "string" ? query : "",
    className: typeof className === "string" ? className : "",
    sort: sort === "asc" || sort === "desc" ? sort : "none",
    problemsOnly: problemsOnly === true,
  };
}

/** Search + class + broken-only + sort. Pure: the input list is never changed. */
export function applyFilter(students: readonly IndexedStudent[], filter: Filter): IndexedStudent[] {
  const query = filter.query.trim().toLowerCase().replace(/\s+/g, " ");
  let result = students.filter((s) => {
    if (query !== "" && !s.nameKey.includes(query)) return false;
    if (filter.className !== "" && s.raw.class_name !== filter.className) return false;
    if (filter.problemsOnly && s.problem === null) return false;
    return true;
  });
  if (filter.sort !== "none") {
    const direction = filter.sort === "asc" ? 1 : -1;
    result = result.sort((a, b) => {
      if (a.scoreValue === null || b.scoreValue === null) {
        return a.scoreValue === b.scoreValue ? 0 : a.scoreValue === null ? 1 : -1; // a score that is not a number goes last either way
      }
      return (a.scoreValue - b.scoreValue) * direction;
    });
  }
  return result;
}
```

### `frontend/src/directory/ErrorBoundary.tsx`

```tsx
import { Component, type ReactNode } from "react";

export type ErrorBoundaryProps = {
  /** What to show instead of the broken part. */
  fallback: (error: Error) => ReactNode;
  /** When this value changes, the boundary tries its children again (for example, the record was fixed). */
  resetKey?: unknown;
  /** Called once per caught error, so it can be reported. */
  onError?: (error: Error) => void;
  children: ReactNode;
};

type State = { error: Error | null; resetKey: unknown };

/** A boundary stops a render error from climbing up and blanking the page. It catches errors made WHILE RENDERING its children.
 *  It does NOT catch errors in event handlers, in timers, or in async code: those need try/catch. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    if (!Object.is(props.resetKey, state.resetKey)) return { error: null, resetKey: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
```

### `frontend/src/directory/StudentRow.tsx`

```tsx
import { bump } from "../perf/counters";
import { ErrorBoundary } from "./ErrorBoundary";
import { BrokenRecordError, readStudent, type IndexedStudent } from "./records";

export const ROW_HEIGHT = 56;

export type StudentRowProps = {
  student: IndexedStudent;
  selected: boolean;
  onSelect: (id: number) => void;
};

/** One row. `readStudent` throws for a broken record: that throw happens inside this row's own ErrorBoundary. */
export function StudentRow({ student, selected, onSelect }: StudentRowProps) {
  bump("row");
  const s = readStudent(student.raw);
  return (
    <button type="button" className={selected ? "row selected" : "row"} aria-pressed={selected} onClick={() => onSelect(s.id)}>
      <span className="row-name">{s.name}</span>
      <span className="row-class">Class {s.className}</span>
      <span className="row-score">{s.score}</span>
    </button>
  );
}

export function brokenMessage(error: Error, id: number): string {
  return error instanceof BrokenRecordError ? `Record #${id} can't be shown: ${error.problem}.` : `Record #${id} can't be shown.`;
}

/** The list item: the row inside its own boundary. A broken record costs exactly one row. */
export function RowItem({ student, selected, onSelect }: StudentRowProps) {
  const id = student.raw.id;
  return (
    <ErrorBoundary resetKey={student.raw} fallback={(error) => <div className="row row-broken" role="alert">{brokenMessage(error, id)}</div>}>
      <StudentRow student={student} selected={selected} onSelect={onSelect} />
    </ErrorBoundary>
  );
}
```

### `frontend/src/directory/StudentCard.tsx`

```tsx
import { bump } from "../perf/counters";
import { readStudent, scoreBand, type IndexedStudent } from "./records";

export type StudentCardProps = {
  student: IndexedStudent;
  onClose: () => void;
};

/** The detail card. Throws for a broken record; the Directory wraps it in an ErrorBoundary. */
export function StudentCard({ student, onClose }: StudentCardProps) {
  bump("card");
  const s = readStudent(student.raw);
  return (
    <section className="card" aria-label="Student details">
      <h2>{s.name}</h2>
      <dl>
        <dt>Student number</dt>
        <dd>{s.id}</dd>
        <dt>Class</dt>
        <dd>{s.className}</dd>
        <dt>Score</dt>
        <dd>
          {s.score} ({scoreBand(s.score)})
        </dd>
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
```

### `frontend/src/directory/lists/types.ts`

```ts
import type { IndexedStudent } from "../records";

export type ListProps = {
  students: readonly IndexedStudent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** When this text changes (a new search, class or sort) the list jumps back to the top. */
  scrollResetKey: string;
};
```

### `frontend/src/directory/lists/PlainList.tsx` (the BEFORE)

```tsx
import { RowItem } from "../StudentRow";
import type { ListProps } from "./types";

/** BEFORE: every matching row is on the page, and nothing is protected from re-rendering. */
export function PlainList({ students, selectedId, onSelect }: ListProps) {
  return (
    <ul className="plain-list" aria-label="Students">
      {students.map((s) => (
        <li key={s.raw.id}>
          <RowItem student={s} selected={s.raw.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
```

### `frontend/src/directory/lists/MemoList.tsx` (the memo trap, and its fix)

```tsx
import { memo } from "react";
import { RowItem } from "../StudentRow";
import type { ListProps } from "./types";

/** `memo` = "skip this row if its props are the same as last time". */
const MemoRowItem = memo(RowItem);

/** The TRAP: memo is there, but a brand-new arrow function is passed every time. New function = "different props" = memo never skips. */
export function MemoInlineList({ students, selectedId, onSelect }: ListProps) {
  return (
    <ul className="plain-list" aria-label="Students">
      {students.map((s) => (
        <li key={s.raw.id}>
          <MemoRowItem student={s} selected={s.raw.id === selectedId} onSelect={(id) => onSelect(id)} />
        </li>
      ))}
    </ul>
  );
}

/** The fix: pass the SAME function every time (the Directory keeps it stable with useCallback). */
export function MemoList({ students, selectedId, onSelect }: ListProps) {
  return (
    <ul className="plain-list" aria-label="Students">
      {students.map((s) => (
        <li key={s.raw.id}>
          <MemoRowItem student={s} selected={s.raw.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
```

### `frontend/src/directory/lists/VirtualList.tsx` (the AFTER)

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef } from "react";
import { ROW_HEIGHT, RowItem } from "../StudentRow";
import type { ListProps } from "./types";

export const LIST_HEIGHT = 480;
const MemoRowItem = memo(RowItem);

/** AFTER: only the rows you can see (plus a few above and below) exist on the page. 5,000 students, about 20 rows.
 *  The scroll bar still has the full height, so it feels like one long list. */
export function VirtualList({ students, selectedId, onSelect, scrollResetKey }: ListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: students.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    getItemKey: (index) => students[index]?.raw.id ?? index,
  });

  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [scrollResetKey, virtualizer]);

  return (
    <div ref={scrollerRef} className="scroller" style={{ height: LIST_HEIGHT }} role="region" aria-label="Student list" tabIndex={0}>
      <div role="list" aria-label="Students" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const student = students[item.index];
          if (!student) return null;
          return (
            <div
              key={item.key}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={students.length}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <MemoRowItem student={student} selected={student.raw.id === selectedId} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### `frontend/src/directory/StudentList.tsx`

```tsx
import { MemoInlineList, MemoList } from "./lists/MemoList";
import { PlainList } from "./lists/PlainList";
import type { ListProps } from "./lists/types";
import { VirtualList } from "./lists/VirtualList";

/** The list can be drawn five ways. Only 'virtual' is the real page. The other four exist so the before/after numbers can be repeated:
 *  open the page with ?list=plain (or memo-inline, memo, virtual-deferred). */
export const LIST_MODES = ["plain", "memo-inline", "memo", "virtual", "virtual-deferred"] as const;
export type ListMode = (typeof LIST_MODES)[number];

export function parseListMode(search: string): ListMode {
  const wanted = new URLSearchParams(search).get("list");
  return LIST_MODES.find((m) => m === wanted) ?? "virtual";
}

export type StudentListProps = ListProps & { mode: ListMode };

export function StudentList({ mode, ...props }: StudentListProps) {
  switch (mode) {
    case "plain":
      return <PlainList {...props} />;
    case "memo-inline":
      return <MemoInlineList {...props} />;
    case "memo":
      return <MemoList {...props} />;
    case "virtual":
    case "virtual-deferred":
      return <VirtualList {...props} />;
    default:
      return assertNever(mode);
  }
}

/** If a new mode is added to LIST_MODES and not handled above, this line stops the build (TypeScript error), not the user. */
function assertNever(value: never): never {
  throw new Error(`Unhandled list mode: ${String(value)}`);
}
```

### `frontend/src/directory/useStudents.ts`

```ts
import { useCallback, useEffect, useState } from "react";
import { fetchStudents } from "../api/students";
import type { Fetcher } from "../api/types";
import { indexStudents, type IndexedStudent } from "./records";

/** One of exactly three states. A union type: TypeScript will not let the page forget one of them. */
export type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; students: IndexedStudent[]; queryCount: number | null };

export function useStudents(fetcher: Fetcher = fetchStudents): { state: LoadState; reload: () => void } {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetcher(controller.signal).then(
      (result) => {
        try {
          setState({ status: "ready", students: indexStudents(result.students), queryCount: result.queryCount });
        } catch {
          setState({ status: "error", message: "The server sent a list the page could not read." }); // never stay on "Loading" forever
        }
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return; // we left the page; nothing to show
        setState({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      },
    );
    return () => controller.abort();
  }, [fetcher, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
```

### `frontend/src/directory/FilterForm.tsx`

```tsx
import { useId } from "react";
import type { FieldSetting, Values } from "./fieldSchema";

export type FilterFormProps = {
  fields: readonly FieldSetting[];
  values: Values;
  /** The field that was refused last, and why (shown under that field). */
  error: { field: string; message: string } | null;
  onChange: (name: string, value: string | boolean) => void;
};

/** Draws the form from the settings list. No field is written by hand here. */
export function FilterForm({ fields, values, error, onChange }: FilterFormProps) {
  const prefix = useId();
  return (
    <form className="filters" role="search" aria-label="Filter students" onSubmit={(e) => e.preventDefault()}>
      {fields.map((field) => {
        const id = `${prefix}-${field.name}`;
        const message = error?.field === field.name ? error.message : null;
        const describedBy = message ? `${id}-error` : undefined;
        const value = values[field.name];
        return (
          <div className="field" key={field.name}>
            {field.type === "checkbox" ? (
              <label className="check">
                <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(field.name, e.target.checked)} />
                {field.label}
              </label>
            ) : (
              <>
                <label htmlFor={id}>{field.label}</label>
                {field.type === "text" ? (
                  <input
                    id={id}
                    type="search"
                    autoComplete="off"
                    value={typeof value === "string" ? value : ""}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    aria-describedby={describedBy}
                    onChange={(e) => onChange(field.name, e.target.value)}
                  />
                ) : (
                  <select id={id} value={typeof value === "string" ? value : ""} aria-describedby={describedBy} onChange={(e) => onChange(field.name, e.target.value)}>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            {message && (
              <p id={`${id}-error`} className="field-error" role="alert">
                {message}
              </p>
            )}
          </div>
        );
      })}
    </form>
  );
}
```

### `frontend/src/directory/Directory.tsx`

```tsx
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { Fetcher } from "../api/types";
import { bump } from "../perf/counters";
import { ErrorBoundary } from "./ErrorBoundary";
import { defaultValues, parseFieldSettings, parseValues, type Values } from "./fieldSchema";
import settingsFile from "./filter-fields.json";
import { applyFilter, filterFromValues, NO_FILTER } from "./filtering";
import { FilterForm } from "./FilterForm";
import { BrokenRecordError, type IndexedStudent } from "./records";
import { StudentCard } from "./StudentCard";
import { StudentList, type ListMode } from "./StudentList";
import { useStudents, type LoadState } from "./useStudents";

export type DirectoryProps = {
  /** Where the list comes from. Tests pass a fake; the real page uses the Python endpoint. */
  fetcher?: Fetcher;
  /** The filter-field settings. Checked before use. Defaults to filter-fields.json. */
  settings?: unknown;
  listMode?: ListMode;
};

export function Directory({ fetcher, settings = settingsFile, listMode = "virtual" }: DirectoryProps) {
  bump("directory");
  const parsed = useMemo(() => parseFieldSettings(settings), [settings]);
  const { state, reload } = useStudents(fetcher);

  const [typed, setTyped] = useState<Values>({});
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const values = useMemo<Values>(() => (parsed.ok ? { ...defaultValues(parsed.fields), ...typed } : {}), [parsed, typed]);
  const filter = useMemo(() => (parsed.ok ? filterFromValues(values) : NO_FILTER), [parsed, values]);
  // 'virtual-deferred': typing stays urgent, the list may catch up a moment later.
  const deferredFilter = useDeferredValue(filter);
  const listFilter = listMode === "virtual-deferred" ? deferredFilter : filter;

  const onChange = useCallback(
    (name: string, value: string | boolean) => {
      if (!parsed.ok) return;
      const result = parseValues(parsed.fields, { ...values, [name]: value }); // checked BEFORE it is used
      if (!result.ok) {
        setFieldError({ field: result.field, message: result.message });
        return;
      }
      setFieldError(null);
      setTyped(result.values);
    },
    [parsed, values],
  );
  const onSelect = useCallback((id: number) => setSelectedId(id), []); // stable: the same function every render (memo needs this)
  const onClose = useCallback(() => setSelectedId(null), []);

  return (
    <main className="page">
      <h1>Student Directory</h1>
      {parsed.ok ? (
        <FilterForm fields={parsed.fields} values={values} error={fieldError} onChange={onChange} />
      ) : (
        <div className="problem" role="alert">
          <p>The filter settings are not valid, so the filter form is switched off.</p>
          <ul>
            {parsed.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <Body state={state} reload={reload} filter={listFilter} selectedId={selectedId} onSelect={onSelect} onClose={onClose} listMode={listMode} />
    </main>
  );
}

type BodyProps = {
  state: LoadState;
  reload: () => void;
  filter: ReturnType<typeof filterFromValues>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
  listMode: ListMode;
};

function Body({ state, reload, filter, selectedId, onSelect, onClose, listMode }: BodyProps) {
  switch (state.status) {
    case "loading":
      return <p role="status">Loading students…</p>;
    case "error":
      return (
        <div className="problem" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={reload}>
            Try again
          </button>
        </div>
      );
    case "ready":
      return <Ready students={state.students} queryCount={state.queryCount} filter={filter} selectedId={selectedId} onSelect={onSelect} onClose={onClose} listMode={listMode} />;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled state: ${JSON.stringify(value)}`);
}

type ReadyProps = {
  students: IndexedStudent[];
  queryCount: number | null;
  filter: ReturnType<typeof filterFromValues>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
  listMode: ListMode;
};

function Ready({ students, queryCount, filter, selectedId, onSelect, onClose, listMode }: ReadyProps) {
  const shown = useMemo(() => applyFilter(students, filter), [students, filter]);
  const problemCount = useMemo(() => students.reduce((n, s) => n + (s.problem === null ? 0 : 1), 0), [students]);
  const byId = useMemo(() => new Map(students.map((s) => [s.raw.id, s])), [students]);
  const selected = selectedId === null ? undefined : byId.get(selectedId);
  const scrollResetKey = `${filter.query}|${filter.className}|${filter.sort}|${filter.problemsOnly}`;

  return (
    <>
      <p aria-live="polite" className="summary">
        Showing {shown.length.toLocaleString("en-US")} of {students.length.toLocaleString("en-US")} students
      </p>
      {problemCount > 0 && (
        <p className="notice">
          {problemCount} {problemCount === 1 ? "record has" : "records have"} a problem and will show a warning in place of the student. Tick "Show only broken records" to find them.
        </p>
      )}
      <div className="layout">
        {shown.length === 0 ? (
          <p className="empty">No student matches this search.</p>
        ) : (
          <StudentList mode={listMode} students={shown} selectedId={selectedId} onSelect={onSelect} scrollResetKey={scrollResetKey} />
        )}
        {selected && (
          <ErrorBoundary
            resetKey={selected.raw}
            fallback={(error) => (
              <section className="card card-broken" role="alert" aria-label="Student details">
                <p>{error instanceof BrokenRecordError ? `Record #${selected.raw.id} can't be shown: ${error.problem}.` : `Record #${selected.raw.id} can't be shown.`}</p>
                <button type="button" onClick={onClose}>
                  Close
                </button>
              </section>
            )}
          >
            <StudentCard student={selected} onClose={onClose} />
          </ErrorBoundary>
        )}
      </div>
      {queryCount !== null && <p className="footnote">The server ran {queryCount} database {queryCount === 1 ? "query" : "queries"} for this list.</p>}
    </>
  );
}
```

### `frontend/src/App.tsx`

```tsx
import { Directory } from "./directory/Directory";
import { ErrorBoundary } from "./directory/ErrorBoundary";
import { parseListMode } from "./directory/StudentList";

/** The outermost boundary: whatever goes wrong inside, the person still gets a message and a way out, never a white page. */
export function App() {
  return (
    <ErrorBoundary
      fallback={() => (
        <main className="page">
          <div className="problem" role="alert">
            <p>Something went wrong and the directory cannot be shown.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </main>
      )}
    >
      <Directory listMode={parseListMode(window.location.search)} />
    </ErrorBoundary>
  );
}
```

### `frontend/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./perf/counters";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `frontend/src/styles.css`

```css
:root { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #1a1a1a; background: #f6f7f9; }
body { margin: 0; }
.page { max-width: 980px; margin: 0 auto; padding: 16px; }
h1 { margin: 0 0 12px; font-size: 1.6rem; }
.filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; background: #fff; border: 1px solid #dde1e7; border-radius: 8px; padding: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 0.85rem; color: #444; }
.field input[type="search"], .field select { height: 36px; padding: 0 8px; border: 1px solid #aab2bd; border-radius: 6px; font-size: 1rem; min-width: 170px; }
.check { display: flex; gap: 6px; align-items: center; height: 36px; }
.field-error { margin: 0; color: #b42318; font-size: 0.85rem; }
.summary { margin: 12px 0 4px; font-weight: 600; }
.notice { margin: 4px 0 8px; padding: 8px 10px; background: #fff7e0; border: 1px solid #f0d27a; border-radius: 6px; font-size: 0.9rem; }
.problem { margin: 12px 0; padding: 12px; background: #fdecea; border: 1px solid #f1a9a0; border-radius: 8px; }
.footnote { color: #555; font-size: 0.85rem; }
.empty { padding: 24px; text-align: center; color: #555; background: #fff; border: 1px dashed #aab2bd; border-radius: 8px; flex: 1; }
.layout { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.scroller, .plain-list { flex: 1 1 520px; background: #fff; border: 1px solid #dde1e7; border-radius: 8px; overflow-y: auto; }
.plain-list { list-style: none; margin: 0; padding: 0; }
.plain-list li { margin: 0; }
.row { display: grid; grid-template-columns: 1fr 110px 50px; align-items: center; gap: 8px; width: 100%; height: 56px; box-sizing: border-box; padding: 0 12px; border: 0; border-bottom: 1px solid #eef0f3; background: #fff; text-align: left; font: inherit; cursor: pointer; }
.row:hover { background: #f1f6ff; }
.row.selected { background: #dbe8ff; }
.row-score { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.row-class { color: #555; font-size: 0.9rem; }
.row-broken { display: flex; align-items: center; color: #b42318; background: #fff1f0; font-size: 0.9rem; cursor: default; }
.card { flex: 0 1 280px; background: #fff; border: 1px solid #dde1e7; border-radius: 8px; padding: 12px 16px; }
.card h2 { margin: 0 0 8px; font-size: 1.2rem; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 12px; }
.card dt { color: #555; }
.card dd { margin: 0; }
.card-broken { background: #fff1f0; border-color: #f1a9a0; color: #b42318; }
button { font: inherit; }
```

### `frontend/scripts/lib.mjs`

```js
// Shared helpers for the two browser scripts: start the Python server, build the page, serve it, open Chromium.
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
export const frontendDir = resolve(here, "..");
export const backendDir = resolve(frontendDir, "..", "backend");
export const API = "http://127.0.0.1:8000";
export const PAGE = "http://127.0.0.1:4173";
const isWindows = process.platform === "win32";
const python = process.env.PYTHON ?? (isWindows ? "python" : "python3");
const npx = isWindows ? "npx.cmd" : "npx";
// Run vite straight from node_modules (not through npx) so there is ONE process to stop, not a parent and a hidden child.
const viteJs = resolve(frontendDir, "node_modules", "vite", "bin", "vite.js");

async function waitFor(url, label, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start (waited 20 s for ${url})`);
}

/** Starts the Python server and the built page. Returns a stop() that always cleans up. */
export async function startServers() {
  const build = spawnSync(process.execPath, [viteJs, "build", "--logLevel", "error"], { cwd: frontendDir, stdio: "inherit" });
  if (build.status !== 0) throw new Error("vite build failed");
  const children = [];
  const run = (cmd, args, cwd, env = {}) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env }, detached: !isWindows });
    children.push(child);
    return child;
  };
  run(python, ["-m", "uvicorn", "app.main:create_app", "--factory", "--port", "8000", "--log-level", "warning"], backendDir);
  run(process.execPath, [viteJs, "preview", "--logLevel", "error"], frontendDir);
  const stop = () => {
    for (const c of children) {
      try {
        if (isWindows) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
        else process.kill(-c.pid, "SIGTERM"); // the whole group: nothing is left running after the script ends
      } catch {
        /* already gone */
      }
    }
  };
  try {
    await waitFor(`${API}/api/health`, "The Python server");
    await waitFor(PAGE, "The page server");
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Needs the Chromium that Playwright installs:  npx playwright install chromium
 *  (CHROMIUM_PATH can point at a Chrome/Chromium you already have.) */
export async function openBrowser() {
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
```

### `frontend/scripts/check-browser.mjs`

```js
// Real-browser check: the built page + the real Python server, in Chromium. Exit code 0 only if every check passes.
import { openBrowser, PAGE, startServers } from "./lib.mjs";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const stop = await startServers();
const browser = await openBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleProblems.push(m.text());
  });
  page.on("pageerror", (e) => consoleProblems.push(String(e)));
  const rows = () => page.locator('[role="listitem"]');
  const summary = () => page.locator(".summary");

  await check("loads 5,000 students from the real server", async () => {
    await page.goto(PAGE);
    await summary().waitFor();
    expect((await summary().textContent()) === "Showing 5,000 of 5,000 students", `summary was ${await summary().textContent()}`);
  });

  await check("only a few rows exist in the page, not 5,000", async () => {
    const count = await rows().count();
    expect(count > 5 && count < 30, `${count} rows`);
    const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(nodes < 400, `${nodes} elements in the page`);
    return `${count} rows, ${nodes} elements`;
  });

  await check("the server query count is shown (1 query)", async () => {
    expect(((await page.locator(".footnote").textContent()) ?? "").includes("ran 1 database query"), await page.locator(".footnote").textContent());
  });

  await check("the broken-records notice counts all 4", async () => {
    expect(((await page.locator(".notice").textContent()) ?? "").startsWith("4 records have a problem"), await page.locator(".notice").textContent());
  });

  await check("scrolling to the very end shows the last student", async () => {
    await page.locator(".scroller").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForFunction(() => [...document.querySelectorAll('[role="listitem"]')].some((li) => li.getAttribute("aria-posinset") === "5000"));
    const last = rows().last();
    expect(((await last.getAttribute("aria-posinset")) ?? "") === "5000", `last posinset ${await last.getAttribute("aria-posinset")}`);
  });

  await check("a search narrows the list and jumps back to the top", async () => {
    await page.getByLabel("Search by name").fill("aarav");
    await page.waitForFunction(() => !document.querySelector(".summary").textContent.includes("of 5,000 students") || !document.querySelector(".summary").textContent.startsWith("Showing 5,000"));
    const top = await page.locator(".scroller").evaluate((el) => el.scrollTop);
    expect(top === 0, `scrollTop ${top}`);
    const texts = await rows().allTextContents();
    expect(texts.length > 0 && texts.every((t) => /aarav/i.test(t)), "not every row matches");
  });

  await check("the 4 broken records each show a warning, and nothing else breaks", async () => {
    await page.getByLabel("Search by name").fill("");
    await page.getByLabel("Show only broken records").check();
    await page.waitForFunction(() => document.querySelector(".summary").textContent.startsWith("Showing 4 of"));
    const alerts = await page.locator('[role="listitem"] [role="alert"]').allTextContents();
    expect(alerts.length === 4, `${alerts.length} warnings`);
    expect(alerts.some((a) => a.includes("Record #7 ")), "no warning for #7");
    return alerts.join(" | ");
  });

  await check("clicking a normal row opens its card; Close closes it", async () => {
    await page.getByLabel("Show only broken records").uncheck();
    await page.waitForFunction(() => document.querySelector(".summary").textContent.startsWith("Showing 5,000"));
    await rows().nth(1).locator("button").click();
    const card = page.getByRole("region", { name: "Student details" });
    await card.waitFor();
    expect(((await card.textContent()) ?? "").includes("Student number"), "card has no details");
    await card.getByRole("button", { name: "Close" }).click();
    await card.waitFor({ state: "detached" });
  });

  await check("keyboard: Tab reaches a row and Enter opens its card", async () => {
    await page.getByLabel("Search by name").focus();
    await page.keyboard.press("Tab"); // Class
    await page.keyboard.press("Tab"); // Sort
    await page.keyboard.press("Tab"); // checkbox
    await page.keyboard.press("Tab"); // the scroll box itself
    await page.keyboard.press("Tab"); // first row button
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "Student details" }).waitFor();
  });

  await check("the page logged no errors while all of that happened (broken-row errors excepted)", async () => {
    const unexpected = consoleProblems.filter((m) => !/Record #|BrokenRecordError|The above error occurred|Student #/.test(m));
    expect(unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
    return `${consoleProblems.length} expected broken-row messages`;
  });

  await check("?list=banana falls back to the real list", async () => {
    await page.goto(`${PAGE}/?list=banana`);
    await summary().waitFor();
    const count = await rows().count();
    expect(count < 30, `${count} rows`);
  });

  await check("server unreachable: a plain message and Try again works", async () => {
    await page.route("**/api/students", (route) => route.abort());
    await page.goto(PAGE);
    await page.getByText("Cannot reach the server. Is it running?").waitFor();
    await page.unroute("**/api/students");
    await page.getByRole("button", { name: "Try again" }).click();
    await summary().waitFor();
  });

  await check("server error 500: says the status", async () => {
    await page.route("**/api/students", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto(PAGE);
    await page.getByText("The server answered 500.").waitFor();
    await page.unroute("**/api/students");
  });

  await check("server sends junk: a message, not an endless 'Loading'", async () => {
    await page.route("**/api/students", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"not":"a list"}' }));
    await page.goto(PAGE);
    await page.getByText("not a student list").waitFor();
    await page.unroute("**/api/students");
  });

  await check("responses are compressed (gzip)", async () => {
    const response = await page.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "gzip" } });
    const encoding = response.headers()["content-encoding"];
    expect(encoding === "gzip", `content-encoding was ${encoding}`);
  });

  await context.close();
} finally {
  await browser.close();
  stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} browser checks passed.`);
process.exit(failed === 0 ? 0 : 1);
```

### `frontend/scripts/measure.mjs`

```js
// Speed measurements in real Chromium with the CPU slowed 4x (a mid-range phone). Same 5,000 students, five ways of drawing the list.
// Writes perf/last-run.md. Numbers depend on the machine; compare the rows with each other, not with someone else's table.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { frontendDir, median, openBrowser, PAGE, startServers } from "./lib.mjs";

const MODES = ["plain", "memo-inline", "memo", "virtual", "virtual-deferred"];
const RUNS = Number(process.env.RUNS ?? 3);
const THROTTLE = Number(process.env.THROTTLE ?? 4);

/** Runs inside the page. Types one letter at a time like a person and times each letter two ways:
 *  painted = until the browser has drawn the next frame after the letter (how it FEELS: does the box keep up?),
 *  settled = until the browser has nothing left to do (the list has caught up). */
async function typeAndMeasure(text) {
  const input = document.querySelector('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const afterPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const idle = () => new Promise((r) => requestIdleCallback(() => r(), { timeout: 10000 }));
  const painted = [];
  const settled = [];
  let typed = "";
  for (const ch of text) {
    typed += ch;
    const t0 = performance.now();
    setter.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await afterPaint();
    painted.push(performance.now() - t0);
    await idle();
    settled.push(performance.now() - t0);
  }
  return { painted, settled };
}

async function measureMode(browser, mode) {
  const rows = { load: [], elements: [], keyPainted: [], keySettled: [], clickPainted: [], rowsAfterKey: [], rowsAfterClick: [] };
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    await page.goto(`${PAGE}/?list=${mode}&perf`, { waitUntil: "commit" });
    await page.locator(".summary").waitFor({ timeout: 120000 });
    const load = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
    rows.load.push(load);
    rows.elements.push(await page.evaluate(() => document.querySelectorAll("*").length));

    await page.evaluate(() => window.__perf.reset());
    const typing = await page.evaluate(`(${typeAndMeasure.toString()})("aarav")`);
    rows.keyPainted.push(Math.max(...typing.painted)); // the WORST letter, not the median: one slow letter is what a person feels
    rows.keySettled.push(Math.max(...typing.settled));
    rows.rowsAfterKey.push(await page.evaluate(() => window.__perf.get().row ?? 0));

    await page.getByLabel("Search by name").fill("");
    await page.locator(".summary", { hasText: "Showing 5,000" }).waitFor({ timeout: 120000 });
    await page.evaluate(() => window.__perf.reset());
    const clickMs = await page.evaluate(async () => {
      const button = document.querySelectorAll('[aria-pressed]')[3];
      const t0 = performance.now();
      button.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return performance.now() - t0;
    });
    rows.clickPainted.push(clickMs);
    rows.rowsAfterClick.push(await page.evaluate(() => window.__perf.get().row ?? 0));
    await context.close();
  }
  const m = (xs) => Math.round(median(xs));
  return {
    mode,
    load: m(rows.load),
    elements: m(rows.elements),
    keyPainted: m(rows.keyPainted),
    keySettled: m(rows.keySettled),
    rowsAfterKey: m(rows.rowsAfterKey),
    clickPainted: m(rows.clickPainted),
    rowsAfterClick: m(rows.rowsAfterClick),
  };
}

const stop = await startServers();
const browser = await openBrowser();
const results = [];
try {
  // wire size (no browser slow-down needed)
  const context = await browser.newContext();
  const gz = await context.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "gzip" } });
  const plain = await context.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "identity" } });
  const gzBytes = (await gz.body()).length; // Playwright may already decode; use the header when the server sent one
  const sent = Number(gz.headers()["content-length"] ?? gzBytes);
  const rawBytes = (await plain.body()).length;
  await context.close();

  for (const mode of MODES) {
    process.stdout.write(`measuring ${mode} ... `);
    const r = await measureMode(browser, mode);
    results.push(r);
    console.log(`load ${r.load} ms, ${r.elements} elements, worst letter ${r.keyPainted}/${r.keySettled} ms, click ${r.clickPainted} ms`);
  }

  const lines = [
    `# Last measurement run`,
    ``,
    `5,000 students, Chromium, CPU slowed ${THROTTLE}x, median of ${RUNS} runs (worst of the 5 letters in each run). Times in milliseconds.`,
    ``,
    `| Way of drawing the list | Page ready | Elements on page | Worst letter: until drawn | Worst letter: list caught up | Rows redrawn typing 5 letters | Click a row: until drawn | Rows redrawn by a click |`,
    `|---|---|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.mode} | ${r.load} | ${r.elements} | ${r.keyPainted} | ${r.keySettled} | ${r.rowsAfterKey} | ${r.clickPainted} | ${r.rowsAfterClick} |`),
    ``,
    `List sent over the network: ${rawBytes.toLocaleString("en-US")} bytes uncompressed, ${sent.toLocaleString("en-US")} bytes with gzip (${(rawBytes / sent).toFixed(1)}x smaller).`,
    ``,
  ];
  mkdirSync(resolve(frontendDir, "perf"), { recursive: true });
  writeFileSync(resolve(frontendDir, "perf", "last-run.md"), lines.join("\n"));
  console.log("\n" + lines.join("\n"));
} finally {
  await browser.close();
  stop();
}
```

### `SLOW_DEFINITION.md`

```markdown
# What "slow" means for this page

Written **before** the measurements, so the numbers cannot be bent to look good afterwards.
The page shows 5,000 students. "Slow" is judged on a Chromium browser with the CPU slowed 4 times (about a mid-range phone), because a fast laptop hides problems.

| # | Question a person would ask | Slow if | Fast enough if |
|---|---|---|---|
| 1 | How long until I can see the list? | more than 1,500 ms | 1,000 ms or less |
| 2 | I typed a letter. How long until the box and list show it? (worst of 5 letters) | more than 200 ms | 100 ms or less |
| 3 | I clicked a student. How long until the card appears? | more than 200 ms | 100 ms or less |
| 4 | How big is the page's own structure? | more than 5,000 elements | 1,500 elements or fewer |
| 5 | How many database queries does the server run for one list? | more than 1 | exactly 1 |
| 6 | How many bytes travel over the network for the list? | more than 100 KB | 100 KB or less |

Why these lines: about 100 ms is where an action stops feeling instant; about 1 second is where a person starts to wonder if the page is working.
These are my choices for this page. They are not an official standard.

## Result of the final run

See `frontend/perf/last-run.md` for the full table (re-create it with `npm run measure` inside `frontend`).

| # | Plain list (before) | Virtual list (after) | Rule met by "after"? |
|---|---|---|---|
| 1 | about 2,100 ms | about 760 ms | yes |
| 2 | about 270 ms | about 35 ms | yes |
| 3 | about 580 ms | about 18 ms | yes |
| 4 | about 25,000 elements | about 120 elements | yes |
| 5 | 5,001 queries (old way) | 1 query | yes |
| 6 | about 313 KB | about 41 KB with gzip | yes |

The numbers come from one sandbox machine (Linux, headless Chromium, CPU slowed 4x). Your machine will give different numbers. Compare the rows with each other, not with these.
```

### `break47.py`

```python
"""Break each rule once on purpose and check that the tests notice.
Run from the project folder:   python break47.py            (all)     or    python break47.py "filter" "memo"   (only names that contain a word)
Each case edits one file, runs that side's whole test suite (Python tests for the server, vitest for the page), expects it to FAIL,
then puts the file back. The page's tests take about 10 seconds per case."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
B = ROOT / "backend" / "app"
F = ROOT / "frontend" / "src"
D = F / "directory"
IS_WINDOWS = sys.platform == "win32"

# (name, suite, file, old text, new text)      suite: "py" = server tests, "js" = page tests
CASES = [
  # ---- server ----
  ("server: LEFT JOIN becomes JOIN (a student with no class vanishes)", "py", B/"queries.py", "FROM students s LEFT JOIN classes c", "FROM students s JOIN classes c"),
  ("server: list no longer sorted by id", "py", B/"queries.py", '"ORDER BY s.id"', '""'),
  ("server: endpoint goes back to one query per student", "py", B/"main.py", "rows = list_students(conn)", 'rows = __import__("app.queries", fromlist=["x"]).list_students_one_query_per_row(conn)'),
  ("server: query count header missing", "py", B/"main.py", 'response.headers["X-Query-Count"] = str(counter.count)', "pass"),
  ("server: timing header missing", "py", B/"main.py", 'response.headers["Server-Timing"] =', 'response.headers["X-Other"] ='),
  ("server: page on another port cannot read the headers", "py", B/"main.py", 'response.headers["Access-Control-Expose-Headers"] = "X-Query-Count, Server-Timing"', "pass"),
  ("server: gzip switched off", "py", B/"main.py", "app.add_middleware(GZipMiddleware, minimum_size=1000)", "pass"),
  ("server: a response model hides the broken rows", "py", B/"main.py", '@app.get("/api/students")', '@app.get("/api/students", response_model=list[dict[str, str]])'),
  ("server: counter counts twice", "py", B/"db.py", "self.count += 1", "self.count += 2"),
  ("server: counter never attached", "py", B/"db.py", "conn.set_trace_callback(counter)", "pass"),
  ("server: database re-seeded on every start", "py", B/"db.py", "    if not path.exists():", "    if True:"),
  ("server: one broken row fewer", "py", B/"seed.py", "BROKEN = {", "BROKEN = {-1, "),
  # ---- records ----
  ("record: missing name not noticed", "js", D/"records.ts", 'if (raw.name === null || raw.name === undefined) return "the name is missing";', ""),
  ("record: a name that is not text not noticed", "js", D/"records.ts", 'if (typeof raw.name !== "string") return "the name is not text";', ""),
  ("record: an empty name accepted", "js", D/"records.ts", 'if (raw.name.trim() === "") return "the name is empty";', ""),
  ("record: infinity accepted as a score", "js", D/"records.ts", " || !Number.isFinite(raw.score)", ""),
  ("record: an empty class accepted", "js", D/"records.ts", ' || raw.class_name.trim() === ""', ""),
  ("record: an array accepted as a row", "js", D/"records.ts", " && !Array.isArray(row)", ""),
  ("record: a row that is not an object crashes the list", "js", D/"records.ts", "return rows.map(asRow).map(", "return rows.map((r) => r as RawStudent).map("),
  ("record: score band edge (90 is not Excellent)", "js", D/"records.ts", "if (score >= 90)", "if (score > 90)"),
  # ---- filtering ----
  ("filter: search is case-sensitive", "js", D/"filtering.ts", "filter.query.trim().toLowerCase()", "filter.query.trim()"),
  ("filter: search spaces not collapsed", "js", D/"filtering.ts", '.replace(/\\s+/g, " ")', ""),
  ("filter: class filter inverted", "js", D/"filtering.ts", "s.raw.class_name !== filter.className", "s.raw.class_name === filter.className"),
  ("filter: 'broken only' ignored", "js", D/"filtering.ts", "if (filter.problemsOnly && s.problem === null) return false;", ""),
  ("filter: sort direction flipped", "js", D/"filtering.ts", 'filter.sort === "asc" ? 1 : -1', 'filter.sort === "asc" ? -1 : 1'),
  ("filter: scores that are not numbers sort first", "js", D/"filtering.ts", "a.scoreValue === null ? 1 : -1", "a.scoreValue === null ? -1 : 1"),
  ("filter: sorts the original list in place", "js", D/"filtering.ts", "result = result.sort((a, b) => {", "result = (students as IndexedStudent[]).sort((a, b) => {"),
  # ---- form settings ----
  ("settings: text limit not enforced", "js", D/"fieldSchema.ts", "z.string().max(field.maxLength, `at most ${field.maxLength} characters`)", "z.string()"),
  ("settings: unknown fields accepted in values", "js", D/"fieldSchema.ts", "return z.strictObject(shape);", "return z.object(shape);"),
  ("settings: any text accepted for a select", "js", D/"fieldSchema.ts", "z.enum(field.options.map((o) => o.value) as [string, ...string[]], { error: \"choose one of the listed options\" })", "z.string()"),
  ("settings: duplicate field names allowed", "js", D/"fieldSchema.ts", '.refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, { message: "field names must all be different" })', ""),
  ("settings: a select with one option allowed", "js", D/"fieldSchema.ts", '.min(2, "needs at least 2 options")', ".min(1)"),
  ("settings: extra keys in a field allowed", "js", D/"fieldSchema.ts", "const checkboxField = z.strictObject({", "const checkboxField = z.object({"),
  # ---- error boundary and rows ----
  ("boundary: never tries again when the record changes", "js", D/"ErrorBoundary.tsx", "if (!Object.is(props.resetKey, state.resetKey))", "if (false)"),
  ("boundary: errors not reported", "js", D/"ErrorBoundary.tsx", "this.props.onError?.(error);", ""),
  ("boundary: a thrown text crashes the fallback", "js", D/"ErrorBoundary.tsx", "error instanceof Error ? error : new Error(String(error))", "error as Error"),
  ("row: warning loses the reason", "js", D/"StudentRow.tsx", "return error instanceof BrokenRecordError ?", "return false ?"),
  ("row: selected state not told to screen readers", "js", D/"StudentRow.tsx", " aria-pressed={selected}", ""),
  ("row: click selects the wrong student", "js", D/"StudentRow.tsx", "onClick={() => onSelect(s.id)}", "onClick={() => onSelect(0)}"),
  ("card: details wrong", "js", D/"StudentCard.tsx", "{s.score} ({scoreBand(s.score)})", "{s.score}"),
  # ---- lists ----
  ("memo list: a new function every render (the trap)", "js", D/"lists/MemoList.tsx", "selected={s.raw.id === selectedId} onSelect={onSelect} />\n        </li>\n      ))}\n    </ul>\n  );\n}\n", "selected={s.raw.id === selectedId} onSelect={(id) => onSelect(id)} />\n        </li>\n      ))}\n    </ul>\n  );\n}\n"),
  ("memo list: memo removed", "js", D/"lists/MemoList.tsx", "const MemoRowItem = memo(RowItem);", "const MemoRowItem = RowItem;"),
  ("virtual list: draws far too many rows", "js", D/"lists/VirtualList.tsx", "overscan: 6", "overscan: 5000"),
  ("virtual list: item count missing for screen readers", "js", D/"lists/VirtualList.tsx", "aria-setsize={students.length}", ""),
  ("virtual list: position missing for screen readers", "js", D/"lists/VirtualList.tsx", "aria-posinset={item.index + 1}", ""),
  ("virtual list: does not go back to the top on a new search", "js", D/"lists/VirtualList.tsx", "virtualizer.scrollToOffset(0);", ""),
  ("virtual list: scroll bar loses its full height", "js", D/"lists/VirtualList.tsx", "height: virtualizer.getTotalSize(),", "height: 100,"),
  ("virtual list: rows not placed where they belong", "js", D/"lists/VirtualList.tsx", "transform: `translateY(${item.start}px)`", "transform: `translateY(0px)`"),
  ("list modes: an unknown ?list= value is trusted", "js", D/"StudentList.tsx", "return LIST_MODES.find((m) => m === wanted) ?? \"virtual\";", "return (wanted ?? \"virtual\") as ListMode;"),
  # ---- the page ----
  ("page: onSelect made new on every render", "js", D/"Directory.tsx", "const onSelect = useCallback((id: number) => setSelectedId(id), []);", "const onSelect = (id: number) => setSelectedId(id);"),
  ("page: typed values used before they are checked", "js", D/"Directory.tsx", "      if (!result.ok) {\n        setFieldError", "      if (false) {\n        setFieldError"),
  ("page: count shows the wrong number", "js", D/"Directory.tsx", "Showing {shown.length.toLocaleString(\"en-US\")}", "Showing {students.length.toLocaleString(\"en-US\")}"),
  ("page: one broken record says 'records have'", "js", D/"Directory.tsx", 'problemCount === 1 ? "record has" : "records have"', '"records have"'),
  ("page: query-count footnote always shown", "js", D/"Directory.tsx", "{queryCount !== null && <p", "{true && <p"),
  ("page: 'Try again' does nothing", "js", D/"Directory.tsx", "<button type=\"button\" onClick={reload}>", "<button type=\"button\" onClick={() => {}}>"),
  ("page: bad settings crash instead of switching the form off", "js", D/"Directory.tsx", "const parsed = useMemo(() => parseFieldSettings(settings), [settings]);", "const parsed = useMemo(() => ({ ok: true as const, fields: settings as never }), [settings]);"),
  # ---- loading the list ----
  ("load: request not cancelled when the page closes", "js", D/"useStudents.ts", "return () => controller.abort();", "return () => {};"),
  ("load: a cancelled request shows an error", "js", D/"useStudents.ts", 'if (error instanceof DOMException && error.name === "AbortError") return; // we left the page; nothing to show', ""),
  ("load: an unreadable list leaves the page on 'Loading' forever", "js", D/"useStudents.ts", 'setState({ status: "error", message: "The server sent a list the page could not read." }); // never stay on "Loading" forever', ""),
  ("fetch: server errors not noticed", "js", F/"api/students.ts", "if (!response.ok)", "if (false)"),
  ("fetch: something that is not a list accepted", "js", F/"api/students.ts", "if (!Array.isArray(body)) throw", "if (false) throw"),
  ("fetch: cancel turned into a 'cannot reach' message", "js", F/"api/students.ts", 'if (error instanceof DOMException && error.name === "AbortError") throw error;', ""),
  ("fetch: any text accepted as the query count", "js", F/"api/students.ts", "header !== null && /^\\d+$/.test(header)", "header !== null"),
  ("fetch: cancel signal not passed on", "js", F/"api/students.ts", 'fetch("/api/students", { signal })', 'fetch("/api/students")'),
  ("app: junk list entries not survived", "js", D/"records.ts", "if (typeof row === \"object\" && row !== null && !Array.isArray(row)) return row as RawStudent;", "return row as RawStudent;"),
]


def suite_fails(suite: str) -> bool:
    if suite == "py":
        cmd = [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"]
        cwd = ROOT / "backend"
    else:
        cmd = ["npx", "vitest", "run", "--bail", "1"]
        cwd = ROOT / "frontend"
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=IS_WINDOWS).returncode != 0


def main(words):
    chosen = [c for c in CASES if not words or any(w.lower() in c[0].lower() for w in words)]
    for suite in sorted({c[1] for c in chosen}):
        assert not suite_fails(suite), f"the {suite} tests must pass before anything is broken"
    survivors = []
    for name, suite, path, old, new in chosen:
        original = path.read_text(encoding="utf-8")
        if original.count(old) != 1:
            print(f"BAD CASE (text found {original.count(old)} times): {name}")
            survivors.append(name)
            continue
        try:
            path.write_text(original.replace(old, new), encoding="utf-8")
            caught = suite_fails(suite)
        finally:
            path.write_text(original, encoding="utf-8")
        print(("caught   " if caught else "MISSED   ") + name, flush=True)
        if not caught:
            survivors.append(name)
    for suite in sorted({c[1] for c in chosen}):
        assert not suite_fails(suite), "files were not restored"
    print(f"\n{len(chosen) - len(survivors)} of {len(chosen)} mistakes caught")
    if survivors:
        print("NOT caught:", *survivors, sep="\n  - ")
        sys.exit(1)


main(sys.argv[1:])
```

### `.gitignore`

```text
node_modules/
dist/
__pycache__/
.pytest_cache/
.venv/
*.db
*.db.building
```

### Design decisions

| Decision | Reason |
|---|---|
| Virtual list instead of showing all rows | 25,037 elements made every action slow (524 to 650 ms to select a row). 122 elements makes it 18 ms. |
| `useCallback` for `onSelect` | `memo` compares props; a new function each render makes every row look changed. A test counts redraws through the whole page. |
| `LEFT JOIN`, not `JOIN` | A student whose class is missing must still be returned. The page, not the server, decides how to show it. A test and a break case cover it. |
| Explicit `ORDER BY` | Rows happen to come out in id order here, but SQL does not promise it. A test uses a table where it would show. |
| Server reports its own query count | Measuring from inside is exact; guessing from timing is not. |
| Checks at the edge, per row | The server sends rows as they are. The page checks each row separately, so one bad row never hides 4,999. |
| Form drawn from checked settings (Zod) | A wrong settings file switches the form off with plain reasons; the list still works. |
| Union type for loading / error / ready + `assertNever` | TypeScript stops the build if a state or list mode is forgotten. |
| Pages cancel their request on leave | No state update after the page is gone; a cancelled request shows nothing. |
| `SLOW_DEFINITION.md` written first | Six rules with numbers, so results cannot be judged after the fact. |
| Counting redraws, not only milliseconds | Time changes by machine; 'rows redrawn' does not. |

---

## 7. Tests (222 tests)

**Server (22)** and **page (200)**. `python break47.py` breaks **65** things once each (server and page) and runs the matching suite each time.
First full run: **64 of 65 caught**. The one miss was *row placement* (`translateY`): jsdom cannot see layout, so I added a test that reads the style of each row; after that the case was caught (re-run on its own, not as a second full run).
Other things found while writing the tests, and fixed: a row that is not an object (`null`) **crashed the whole list and left the page on "Loading" forever** (now a broken row, plus a safety net that shows an error with *Try again*); the page had no icon so the browser asked for `/favicon.ico` and got a 404 in the console (fixed); `ORDER BY` could be removed with no test noticing (now a test).

| # | Test | What it proves |
|---|---|---|
| 1 | Server (22) | one query per request; old way is 5,001; both ways give the same rows; counter really counts; headers readable from another port; gzip and wire size at least 3x smaller; the 4 broken rows come back as they are; seed is repeatable; no half-built database file; LEFT JOIN keeps students without a class; ORDER BY by itself sorts |
| 2 | records (30) | every kind of broken row is named; junk entries become broken rows; score bands |
| 3 | fieldSchema (36) | bad settings give plain reasons; values checked before use; text limit; select only listed options |
| 4 | filtering (21) | search, class, broken-only, sort; input list never changed |
| 5 | ErrorBoundary (7) | fallback; retry on new key; error reported once; non-Error thrown; click-handler errors are NOT caught |
| 6 | StudentRow / StudentCard (10) | row text, click, selected; broken row message; card details; broken card throws a catchable error |
| 7 | lists (22) | redraw counts for plain / memo-inline / memo; virtual shows about 20 of 5,000, keeps full scroll height, places rows, scrolls, resets on a new search, not on selection |
| 8 | StudentList (18) | `?list=` reading; every mode draws; unknown mode fails loudly |
| 9 | Directory (32) | loading, error + Try again, abort; counts; search, class, sort; over-long text refused with a message; broken-record notice; card; bad settings; memo redraw counts through the page |
| 10 | api (20) | friendly messages; abort passed through; status codes; query-count header parsing; non-lists refused |
| 11 | App (4) | real fetch path; server down; junk entries |

### `backend/tests/conftest.py`

```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.seed import seed_database


@pytest.fixture(scope="session")
def db_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "students.db"
    seed_database(path)
    return path


@pytest.fixture
def client(db_path):
    return TestClient(create_app(db_path))
```

### `backend/tests/test_endpoint.py`

```python
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
```

### `frontend/src/test/setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { resetCounts } from "../perf/counters";

// React reports problems with console.error. A test must either have none, or take the ones it EXPECTS with takeConsoleErrors()
// (and then say something about them). Anything left over fails the test.
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  resetCounts();
});
afterEach(() => {
  cleanup();
  const left = errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
  errorSpy.mockRestore();
  vi.restoreAllMocks();
  expect(left, "console.error was called during the test and the test did not account for it").toEqual([]);
});

/** Returns the console.error messages so far and forgets them. */
export function takeConsoleErrors(): string[] {
  const calls = errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
  errorSpy.mockClear();
  return calls;
}
```

### `frontend/src/test/fixtures.ts`

```ts
import { vi } from "vitest";
import type { Fetcher, RawStudent, StudentsResult } from "../api/types";

const CLASSES = ["6A", "6B", "6C", "7A", "7B", "7C", "8A", "8B", "8C", "9A", "9B", "9C", "10A", "10B", "10C"];
const FIRST = ["Aarav", "Diya", "Rohan", "Meera", "Karthik", "Ananya", "Teja", "Priya"];
const LAST = ["Reddy", "Goud", "Rao", "Sharma", "Naidu"];

/** n clean students with predictable names, classes and scores (score = 20 + id % 81). */
export function makeStudents(n: number): RawStudent[] {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return { id, name: `${FIRST[id % FIRST.length]} ${LAST[id % LAST.length]} ${id}`, class_name: CLASSES[id % CLASSES.length] ?? "6A", score: 20 + (id % 81) };
  });
}

/** The same four kinds of broken row the Python seed makes. */
export function withBroken(students: RawStudent[]): RawStudent[] {
  return students.map((s) => {
    if (s.id === 7) return { ...s, name: null };
    if (s.id === 12) return { ...s, score: "absent" };
    if (s.id === 15) return { ...s, class_name: null };
    if (s.id === 20) return { ...s, name: 12345 };
    return s;
  });
}

export function fakeFetcher(students: RawStudent[], queryCount: number | null = 1): Fetcher {
  return vi.fn(async (): Promise<StudentsResult> => ({ students, queryCount }));
}

/** jsdom has no layout, so every element is 0 x 0 and a virtual list would draw nothing.
 *  The virtual list reads clientHeight / clientWidth, so give the scroll box a real size. Undone after each test (see setup.ts). */
export function giveScrollerASize(height = 480, width = 600): void {
  const sizeOf = (el: HTMLElement, size: number) => (el.classList.contains("scroller") ? size : 0);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return sizeOf(this, height);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return sizeOf(this, width);
  });
}
```

### `frontend/src/directory/records.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { RawStudent } from "../api/types";
import { BrokenRecordError, describeProblem, indexStudents, readStudent, scoreBand } from "./records";

const good: RawStudent = { id: 1, name: "Aarav Reddy", class_name: "8B", score: 77 };

describe("describeProblem", () => {
  it("is null for a good record", () => expect(describeProblem(good)).toBeNull());
  it.each([
    [{ ...good, name: null }, "the name is missing"],
    [{ ...good, name: 12345 }, "the name is not text"],
    [{ ...good, name: "" }, "the name is empty"],
    [{ ...good, name: "   " }, "the name is empty"],
    [{ ...good, score: "absent" }, "the score is not a number"],
    [{ ...good, score: null }, "the score is not a number"],
    [{ ...good, score: Number.NaN }, "the score is not a number"],
    [{ ...good, score: Number.POSITIVE_INFINITY }, "the score is not a number"],
    [{ ...good, class_name: null }, "the class is missing"],
    [{ ...good, class_name: "" }, "the class is missing"],
  ] as [RawStudent, string][])("says what is wrong (%#)", (raw, expected) => expect(describeProblem(raw)).toBe(expected));

  it("a score of 0 is fine", () => expect(describeProblem({ ...good, score: 0 })).toBeNull());
  it("reports the first problem when several are wrong", () => expect(describeProblem({ id: 3, name: null, class_name: null, score: "x" })).toBe("the name is missing"));
});

describe("readStudent", () => {
  it("returns a clean Student", () => expect(readStudent(good)).toEqual({ id: 1, name: "Aarav Reddy", className: "8B", score: 77 }));
  it("throws BrokenRecordError with the id and the problem", () => {
    try {
      readStudent({ ...good, id: 7, name: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrokenRecordError);
      expect((error as BrokenRecordError).studentId).toBe(7);
      expect((error as BrokenRecordError).problem).toBe("the name is missing");
      expect((error as Error).message).toBe("Student #7: the name is missing");
    }
  });
});

describe("indexStudents", () => {
  it("works out the search key, the numeric score and the problem once", () => {
    const [a, b, c] = indexStudents([good, { ...good, id: 2, name: null, score: "x" }, { ...good, id: 3, name: "ÀB Çd" }]);
    expect(a).toMatchObject({ nameKey: "aarav reddy", scoreValue: 77, problem: null });
    expect(b).toMatchObject({ nameKey: "", scoreValue: null, problem: "the name is missing" });
    expect(c?.nameKey).toBe("àb çd");
  });
  it("keeps the original row untouched and in the same order", () => {
    const rows = [good, { ...good, id: 2 }];
    const out = indexStudents(rows);
    expect(out.map((s) => s.raw)).toEqual(rows);
    expect(out[0]?.raw).toBe(rows[0]);
  });
});

describe("scoreBand", () => {
  it.each([[100, "Excellent"], [90, "Excellent"], [89, "Good"], [75, "Good"], [74, "Fair"], [50, "Fair"], [49, "Needs support"], [0, "Needs support"]])("%i is %s", (score, band) =>
    expect(scoreBand(score)).toBe(band),
  );
});

describe("indexStudents with rows that are not objects", () => {
  it.each([[null], ["junk"], [5], [[1, 2]], [undefined]])("turns %j into a broken row instead of crashing", (junk) => {
    const out = indexStudents([{ id: 1, name: "A", class_name: "6A", score: 5 }, junk, { id: 2, name: "B", class_name: "6A", score: 6 }]);
    expect(out).toHaveLength(3);
    expect(out[1]?.problem).toBe("the name is missing");
    expect(out[1]?.raw.id).toBe(-2);
    expect(out[0]?.problem).toBeNull();
    expect(out[2]?.problem).toBeNull();
  });
});
```

### `frontend/src/directory/fieldSchema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import settingsFile from "./filter-fields.json";
import { buildValuesSchema, defaultValues, parseFieldSettings, parseValues, type FieldSetting } from "./fieldSchema";

const text = { name: "query", type: "text", label: "Search", maxLength: 20 };
const select = { name: "sort", type: "select", label: "Sort", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
const check = { name: "flag", type: "checkbox", label: "Flag" };

function fields(input: unknown): FieldSetting[] {
  const r = parseFieldSettings(input);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.fields;
}

describe("the shipped settings file", () => {
  it("passes the check", () => expect(parseFieldSettings(settingsFile).ok).toBe(true));
  it("has the four fields in order", () => expect(fields(settingsFile).map((f) => [f.name, f.type])).toEqual([["query", "text"], ["className", "select"], ["sort", "select"], ["problemsOnly", "checkbox"]]));
  it("lists all 15 classes plus 'all classes'", () => {
    const cls = fields(settingsFile).find((f) => f.name === "className");
    expect(cls?.type === "select" && cls.options.length).toBe(16);
  });
  it("search is limited to 50 characters", () => expect(fields(settingsFile)[0]).toMatchObject({ maxLength: 50 }));
});

describe("a bad settings list is refused, with a plain reason", () => {
  const cases: [string, unknown, RegExp][] = [
    ["not a list", { name: "x" }, /settings/],
    ["an empty list", [], /needs at least one field/],
    ["unknown type", [{ ...text, type: "date" }], /settings\[0\]/],
    ["missing type", [{ name: "q", label: "Q" }], /settings\[0\]/],
    ["select with no options", [{ ...select, options: [] }], /needs at least 2 options/],
    ["select with one option", [{ ...select, options: [{ value: "a", label: "A" }] }], /needs at least 2 options/],
    ["select without options at all", [{ name: "s", type: "select", label: "S" }], /options/],
    ["duplicate option values", [{ ...select, options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }], /option values must all be different/],
    ["option without a label", [{ ...select, options: [{ value: "a", label: "" }, { value: "b", label: "B" }] }], /must not be empty/],
    ["duplicate field names", [text, { ...select, name: "query" }], /field names must all be different/],
    ["a name with a space", [{ ...text, name: "my field" }], /must start with a letter/],
    ["a name that starts with a digit", [{ ...text, name: "1st" }], /must start with a letter/],
    ["an empty label", [{ ...text, label: "   " }], /must not be empty/],
    ["text without maxLength", [{ name: "q", type: "text", label: "Q" }], /maxLength/],
    ["maxLength zero", [{ ...text, maxLength: 0 }], /settings\[0\]\.maxLength/],
    ["maxLength 1.5", [{ ...text, maxLength: 1.5 }], /maxLength/],
    ["maxLength 201", [{ ...text, maxLength: 201 }], /maxLength/],
    ["maxLength as text", [{ ...text, maxLength: "20" }], /maxLength/],
    ["an extra unknown key", [{ ...text, colour: "red" }], /settings\[0\]/],
    ["checkbox with options", [{ ...check, options: [] }], /settings\[0\]/],
    ["a null in the list", [null], /settings\[0\]/],
  ];
  it.each(cases)("%s", (_name, input, pattern) => {
    const r = parseFieldSettings(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toMatch(pattern);
  });

  it("reports the position of the bad field", () => {
    const r = parseFieldSettings([text, check, { ...select, options: [] }]);
    expect(!r.ok && r.problems[0]).toMatch(/^settings\[2\]\.options:/);
  });
  it("reports several problems together", () => {
    const r = parseFieldSettings([{ ...text, maxLength: 0 }, { ...select, options: [] }]);
    expect(!r.ok && r.problems.length).toBeGreaterThanOrEqual(2);
  });
  it("never throws, whatever it is given", () => {
    for (const input of [undefined, null, 5, "x", [[]], [undefined]]) expect(() => parseFieldSettings(input)).not.toThrow();
  });
});

describe("defaultValues", () => {
  it("text is empty, select is the first option, checkbox is off", () => expect(defaultValues(fields([text, select, check]))).toEqual({ query: "", sort: "a", flag: false }));
});

describe("values are checked before they are used", () => {
  const f = fields([text, select, check]);
  it("accepts good values", () => expect(parseValues(f, { query: "ab", sort: "b", flag: true })).toEqual({ ok: true, values: { query: "ab", sort: "b", flag: true } }));
  it("accepts text exactly at the limit and refuses one more", () => {
    expect(parseValues(f, { query: "x".repeat(20), sort: "a", flag: false }).ok).toBe(true);
    const r = parseValues(f, { query: "x".repeat(21), sort: "a", flag: false });
    expect(r).toMatchObject({ ok: false, field: "query" });
    expect(!r.ok && r.message).toBe("Search: at most 20 characters");
  });
  it("refuses a select value that is not an option", () => {
    const r = parseValues(f, { query: "", sort: "z", flag: false });
    expect(r).toMatchObject({ ok: false, field: "sort", message: "Sort: choose one of the listed options" });
  });
  it("refuses the wrong type", () => {
    expect(parseValues(f, { query: 5, sort: "a", flag: false })).toMatchObject({ ok: false, field: "query" });
    expect(parseValues(f, { query: "", sort: "a", flag: "yes" })).toMatchObject({ ok: false, field: "flag" });
  });
  it("refuses a field the settings do not know", () => expect(parseValues(f, { query: "", sort: "a", flag: false, hack: "1" }).ok).toBe(false));
  it("refuses a missing field", () => expect(parseValues(f, { query: "", sort: "a" })).toMatchObject({ ok: false, field: "flag" }));
  it("the schema is built from the same settings (different settings, different rules)", () => {
    const tight = fields([{ ...text, maxLength: 3 }]);
    expect(parseValues(tight, { query: "abcd" }).ok).toBe(false);
    expect(buildValuesSchema(tight).safeParse({ query: "abc" }).success).toBe(true);
  });
});
```

### `frontend/src/directory/filtering.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { makeStudents, withBroken } from "../test/fixtures";
import { applyFilter, filterFromValues, NO_FILTER, type Filter } from "./filtering";
import { indexStudents } from "./records";

const students = indexStudents(withBroken(makeStudents(60)));
const ids = (list: ReturnType<typeof applyFilter>) => list.map((s) => s.raw.id);
const f = (patch: Partial<Filter>): Filter => ({ ...NO_FILTER, ...patch });

describe("applyFilter", () => {
  it("no filter: everything, in the original order", () => expect(ids(applyFilter(students, NO_FILTER))).toEqual(students.map((s) => s.raw.id)));
  it("does not change the list it was given", () => {
    const copy = [...students];
    applyFilter(students, f({ sort: "desc", query: "a" }));
    expect(students).toEqual(copy);
  });
  it("search ignores case", () => expect(ids(applyFilter(students, f({ query: "AARAV" })))).toEqual(ids(applyFilter(students, f({ query: "aarav" })))));
  it("search matches part of a name, anywhere in it", () => {
    expect(applyFilter(students, f({ query: "reddy" })).every((s) => s.nameKey.includes("reddy"))).toBe(true);
    expect(applyFilter(students, f({ query: "arav red" })).length).toBeGreaterThan(0);
  });
  it("search ignores spaces at the ends and doubled spaces", () => expect(ids(applyFilter(students, f({ query: "  aarav   reddy " })))).toEqual(ids(applyFilter(students, f({ query: "aarav reddy" })))));
  it("a search with no match gives an empty list", () => expect(applyFilter(students, f({ query: "zzzz" }))).toEqual([]));
  it("a row with no readable name is never found by a search", () => {
    expect(ids(applyFilter(students, f({ query: "a" })))).not.toContain(7);
    expect(ids(applyFilter(students, f({ query: "12345" })))).not.toContain(20);
  });
  it("class filter keeps only that class", () => {
    const r = applyFilter(students, f({ className: "6B" }));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.raw.class_name === "6B")).toBe(true);
  });
  it("a row with no class is not in any class", () => {
    for (const c of ["6A", "6B", "7A", "10C"]) expect(ids(applyFilter(students, f({ className: c })))).not.toContain(15);
  });
  it("problemsOnly shows exactly the four broken rows", () => expect(ids(applyFilter(students, f({ problemsOnly: true })))).toEqual([7, 12, 15, 20]));
  it("search and class work together (both must match)", () => {
    const r = applyFilter(students, f({ query: "aarav", className: "6B" }));
    expect(r.every((s) => s.nameKey.includes("aarav") && s.raw.class_name === "6B")).toBe(true);
  });
  it("sort low to high puts scores in order", () => {
    const scores = applyFilter(students, f({ sort: "asc" })).map((s) => s.scoreValue).filter((v): v is number => v !== null);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
  it("sort high to low puts scores in order", () => {
    const scores = applyFilter(students, f({ sort: "desc" })).map((s) => s.scoreValue).filter((v): v is number => v !== null);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it("a score that is not a number goes last, both ways", () => {
    expect(applyFilter(students, f({ sort: "asc" })).at(-1)?.raw.id).toBe(12);
    expect(applyFilter(students, f({ sort: "desc" })).at(-1)?.raw.id).toBe(12);
  });
  it("equal scores keep their original order", () => {
    const tied = indexStudents([1, 2, 3, 4].map((id) => ({ id, name: `n${id}`, class_name: "6A", score: 50 })));
    expect(ids(applyFilter(tied, f({ sort: "desc" })))).toEqual([1, 2, 3, 4]);
    expect(ids(applyFilter(tied, f({ sort: "asc" })))).toEqual([1, 2, 3, 4]);
  });
  it("sort and filter together: filter first, then sort what is left", () => {
    const r = applyFilter(students, f({ className: "6B", sort: "desc" }));
    expect(r.every((s) => s.raw.class_name === "6B")).toBe(true);
  });
  it("handles an empty list", () => expect(applyFilter([], f({ query: "a", sort: "asc" }))).toEqual([]));
  it("5,000 students: filter and sort stay far below the time a person can notice", () => {
    const big = indexStudents(makeStudents(5000));
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) applyFilter(big, f({ query: "a", sort: "desc" }));
    expect((performance.now() - t0) / 10).toBeLessThan(50); // measured about 1 to 2 ms; the limit is generous so a slow machine does not fail it
  });
});

describe("filterFromValues", () => {
  it("reads the four known values", () => expect(filterFromValues({ query: "ab", className: "7A", sort: "asc", problemsOnly: true })).toEqual({ query: "ab", className: "7A", sort: "asc", problemsOnly: true }));
  it("anything unexpected becomes 'no filter'", () => expect(filterFromValues({ query: true, className: false, sort: "sideways", problemsOnly: "yes" })).toEqual(NO_FILTER));
  it("an empty object becomes 'no filter'", () => expect(filterFromValues({})).toEqual(NO_FILTER));
});
```

### `frontend/src/directory/ErrorBoundary.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { takeConsoleErrors } from "../test/setup";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("boom");
  return <p>fine</p>;
}

describe("ErrorBoundary", () => {
  it("shows the children when nothing is wrong", () => {
    render(<ErrorBoundary fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("shows the fallback when a child throws while rendering, and the page around it still works", () => {
    render(
      <div>
        <p>outside</p>
        <ErrorBoundary fallback={(e) => <p>fallback: {e.message}</p>}><Bomb explode /></ErrorBoundary>
        <ErrorBoundary fallback={() => <p>other fallback</p>}><Bomb explode={false} /></ErrorBoundary>
      </div>,
    );
    expect(takeConsoleErrors().length).toBeGreaterThan(0); // React still reports it: the error is shown AND logged, never swallowed
    expect(screen.getByText("outside")).toBeInTheDocument();
    expect(screen.getByText("fallback: boom")).toBeInTheDocument();
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByText("other fallback")).not.toBeInTheDocument();
  });

  it("calls onError exactly once per error", () => {
    const onError = vi.fn();
    render(<ErrorBoundary fallback={() => <p>x</p>} onError={onError}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "boom" });
  });

  it("tries again when resetKey changes (the record was fixed)", () => {
    const { rerender } = render(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    expect(screen.getByText("fallback")).toBeInTheDocument();
    rerender(<ErrorBoundary resetKey="v2" fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("stays on the fallback when resetKey does NOT change", () => {
    const { rerender } = render(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    rerender(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  it("turns a thrown non-Error (a string) into an Error", () => {
    function Throws(): never {
      throw "just text"; // eslint-disable-line no-throw-literal
    }
    render(<ErrorBoundary fallback={(e) => <p>{e instanceof Error ? e.message : "not an error"}</p>}><Throws /></ErrorBoundary>);
    takeConsoleErrors();
    expect(screen.getByText("just text")).toBeInTheDocument();
  });

  it("does NOT catch an error thrown in a click handler (that needs try/catch)", async () => {
    const seen: string[] = [];
    const listener = (event: ErrorEvent) => {
      seen.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", listener);
    function Button() {
      const [n, setN] = useState(0);
      return <button onClick={() => { setN(n + 1); throw new Error("handler broke"); }}>click {n}</button>;
    }
    render(<ErrorBoundary fallback={() => <p>fallback</p>}><Button /></ErrorBoundary>);
    await userEvent.click(screen.getByRole("button"));
    window.removeEventListener("error", listener);
    takeConsoleErrors();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument(); // the boundary did not fire
    expect(seen.join(" ")).toContain("handler broke"); // the error went to the window instead
  });
});
```

### `frontend/src/directory/StudentRow.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getCounts } from "../perf/counters";
import { takeConsoleErrors } from "../test/setup";
import { indexStudents } from "./records";
import { brokenMessage, RowItem } from "./StudentRow";
import { BrokenRecordError } from "./records";

const [good, broken] = indexStudents([
  { id: 1, name: "Aarav Reddy", class_name: "8B", score: 77 },
  { id: 7, name: null, class_name: "8B", score: 77 },
]);

describe("RowItem", () => {
  it("shows name, class and score", () => {
    render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Aarav Reddy");
    expect(row).toHaveTextContent("Class 8B");
    expect(row).toHaveTextContent("77");
  });
  it("tells the click which student it was", async () => {
    const onSelect = vi.fn();
    render(<RowItem student={good!} selected={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("tells a screen reader which row is selected", () => {
    const { rerender } = render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<RowItem student={good!} selected onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
  it("a broken record shows a message with its number and the reason, not a crash", () => {
    render(<RowItem student={broken!} selected={false} onSelect={() => {}} />);
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Record #7 can't be shown: the name is missing.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("renders the row once per render and counts it", () => {
    render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    expect(getCounts().row).toBe(1);
  });
});

describe("brokenMessage", () => {
  it("names the problem for a BrokenRecordError", () => expect(brokenMessage(new BrokenRecordError(3, "the score is not a number"), 3)).toBe("Record #3 can't be shown: the score is not a number."));
  it("is still kind for any other error", () => expect(brokenMessage(new Error("x"), 3)).toBe("Record #3 can't be shown."));
});
```

### `frontend/src/directory/StudentCard.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { takeConsoleErrors } from "../test/setup";
import { ErrorBoundary } from "./ErrorBoundary";
import { BrokenRecordError, indexStudents } from "./records";
import { StudentCard } from "./StudentCard";

const [good] = indexStudents([{ id: 3, name: "Diya Goud", class_name: "7B", score: 91 }]);
const [bad] = indexStudents([{ id: 9, name: "X", class_name: "7B", score: "absent" }]);

describe("StudentCard", () => {
  it("shows the student's details and the score band", () => {
    render(<StudentCard student={good!} onClose={() => {}} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Diya Goud");
    expect(screen.getByText("Student number").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Class").nextElementSibling).toHaveTextContent("7B");
    expect(screen.getByText("Score").nextElementSibling).toHaveTextContent("91 (Excellent)");
  });
  it("Close calls onClose", async () => {
    const onClose = vi.fn();
    render(<StudentCard student={good!} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("a broken record throws a BrokenRecordError that a boundary can catch", () => {
    let caught: Error | undefined;
    render(
      <ErrorBoundary fallback={(e) => <p>fallback</p>} onError={(e) => (caught = e)}>
        <StudentCard student={bad!} onClose={() => {}} />
      </ErrorBoundary>,
    );
    takeConsoleErrors();
    expect(caught).toBeInstanceOf(BrokenRecordError);
    expect(caught).toMatchObject({ studentId: 9, problem: "the score is not a number" });
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });
});
```

### `frontend/src/directory/lists/lists.test.tsx`

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getCounts, resetCounts } from "../../perf/counters";
import { giveScrollerASize, makeStudents } from "../../test/fixtures";
import { takeConsoleErrors } from "../../test/setup";
import { indexStudents } from "../records";
import { MemoInlineList, MemoList } from "./MemoList";
import { PlainList } from "./PlainList";
import type { ListProps } from "./types";
import { VirtualList } from "./VirtualList";

const all = indexStudents(makeStudents(200));

/** jsdom cannot scroll; this records the position the list asks the scroll box to go to. */
function watchScrollTo(scroller: HTMLElement, asked: number[]): void {
  scroller.scrollTo = ((a?: number | ScrollToOptions) => {
    asked.push(typeof a === "object" ? (a.top ?? 0) : (a ?? 0));
  }) as typeof scroller.scrollTo;
}
const base = (patch: Partial<ListProps> = {}): ListProps => ({ students: all, selectedId: null, onSelect: () => {}, scrollResetKey: "", ...patch });

/** Draw the list, then change what it shows (as a search would), and count how many rows had to be drawn again. */
function rowsRedrawnAfter(List: (p: ListProps) => React.ReactElement, change: (p: ListProps) => ListProps): number {
  const onSelect = () => {};
  const { rerender } = render(<List {...base({ onSelect })} />);
  resetCounts();
  rerender(<List {...change(base({ onSelect }))} />);
  return getCounts().row ?? 0;
}

describe("how many rows redraw when the search narrows 200 students to 150", () => {
  const narrow = (p: ListProps): ListProps => ({ ...p, students: p.students.slice(0, 150) });
  it("plain: all 150 draw again", () => expect(rowsRedrawnAfter(PlainList, narrow)).toBe(150));
  it("memo with a new inline function each time: still all 150 (memo does nothing)", () => expect(rowsRedrawnAfter(MemoInlineList, narrow)).toBe(150));
  it("memo with the same function each time: none", () => expect(rowsRedrawnAfter(MemoList, narrow)).toBe(0));
});

describe("how many rows redraw when one student is selected", () => {
  const select = (p: ListProps): ListProps => ({ ...p, selectedId: 5 });
  it("plain: all 200", () => expect(rowsRedrawnAfter(PlainList, select)).toBe(200));
  it("memo with an inline function: all 200", () => expect(rowsRedrawnAfter(MemoInlineList, select)).toBe(200));
  it("memo with a stable function: only the one that changed", () => expect(rowsRedrawnAfter(MemoList, select)).toBe(1));
  it("memo: moving the selection redraws exactly two rows (the old and the new)", () => {
    const onSelect = () => {};
    const { rerender } = render(<MemoList {...base({ onSelect, selectedId: 5 })} />);
    resetCounts();
    rerender(<MemoList {...base({ onSelect, selectedId: 9 })} />);
    expect(getCounts().row).toBe(2);
  });
});

describe("the plain lists", () => {
  it.each([["plain", PlainList], ["memo", MemoList], ["memo-inline", MemoInlineList]] as const)("%s puts every row on the page", (_n, List) => {
    render(<List {...base()} />);
    expect(screen.getAllByRole("button")).toHaveLength(200);
  });
});

describe("VirtualList", () => {
  const big = indexStudents(makeStudents(5000));

  it("puts about 20 rows on the page, not 5,000", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.length).toBeLessThanOrEqual(25);
    expect(rows[0]).toHaveTextContent(/Rohan Naidu 5000|Diya Goud 1|Aarav/);
  });

  it("still tells screen readers there are 5,000 items and which one each is", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const first = screen.getAllByRole("listitem")[0]!;
    expect(first).toHaveAttribute("aria-setsize", "5000");
    expect(first).toHaveAttribute("aria-posinset", "1");
  });

  it("places each row where it belongs: row number x 56 px from the top", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    for (const li of screen.getAllByRole("listitem")) {
      const index = Number(li.getAttribute("aria-posinset")) - 1;
      expect(li.style.transform).toBe(`translateY(${index * 56}px)`);
      expect(li.style.height).toBe("56px");
    }
  });

  it("keeps the full scroll height so the scroll bar is honest", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    expect(screen.getByRole("list")).toHaveStyle({ height: `${5000 * 56}px` });
  });

  it("shows later rows after scrolling", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    act(() => {
      scroller.scrollTop = 56 * 2500;
      fireEvent.scroll(scroller);
    });
    const positions = screen.getAllByRole("listitem").map((li) => Number(li.getAttribute("aria-posinset")));
    expect(Math.min(...positions)).toBeGreaterThan(2400);
    expect(Math.max(...positions)).toBeLessThan(2600);
    expect(screen.queryByText(/ 1$/)).not.toBeInTheDocument();
  });

  it("draws fewer rows when there are fewer students", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: all.slice(0, 3) })} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("a click on a visible row selects that student", () => {
    giveScrollerASize();
    const onSelect = vi.fn();
    render(<VirtualList {...base({ students: big, onSelect })} />);
    fireEvent.click(screen.getAllByRole("button")[2]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a broken record in view costs one row; the others still draw", () => {
    giveScrollerASize();
    const rows = makeStudents(30);
    rows[2] = { ...rows[2]!, name: null };
    render(<VirtualList {...base({ students: indexStudents(rows) })} />);
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(8);
  });

  it("selecting redraws only the rows whose selected flag changed", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect })} />);
    resetCounts();
    rerender(<VirtualList {...base({ students: big, onSelect, selectedId: 3 })} />);
    expect(getCounts().row).toBe(1);
  });

  it("goes back to the top when the search changes (scrollResetKey)", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a" })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    // jsdom has no scrolling; record what the list asks for.
    const asked: number[] = [];
    watchScrollTo(scroller, asked);
    act(() => {
      scroller.scrollTop = 56 * 1000;
      fireEvent.scroll(scroller);
    });
    asked.length = 0;
    rerender(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "b" })} />);
    expect(asked).toContain(0);
  });

  it("does not jump to the top when only the selection changes", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a" })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    const asked: number[] = [];
    watchScrollTo(scroller, asked);
    rerender(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a", selectedId: 4 })} />);
    expect(asked).toEqual([]);
  });

  it("is labelled, and the scroll box can be reached with the keyboard", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    expect(screen.getByRole("region", { name: "Student list" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("list", { name: "Students" })).toBeInTheDocument();
  });
});
```

### `frontend/src/directory/StudentList.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { giveScrollerASize, makeStudents } from "../test/fixtures";
import { indexStudents } from "./records";
import { LIST_MODES, parseListMode, StudentList, type ListMode } from "./StudentList";

describe("parseListMode", () => {
  it("defaults to virtual", () => {
    expect(parseListMode("")).toBe("virtual");
    expect(parseListMode("?perf")).toBe("virtual");
  });
  it.each(LIST_MODES)("understands ?list=%s", (mode) => expect(parseListMode(`?list=${mode}`)).toBe(mode));
  it.each([["?list=banana"], ["?list="], ["?list=PLAIN"], ["?list=plain%20"], ["?lists=plain"]])("falls back to virtual for %s", (q) => expect(parseListMode(q)).toBe("virtual"));
  it("works next to other parameters", () => expect(parseListMode("?perf&list=memo")).toBe("memo"));
});

describe("StudentList", () => {
  it.each(LIST_MODES)("draws something for %s", (mode) => {
    giveScrollerASize();
    render(<StudentList mode={mode} students={indexStudents(makeStudents(20))} selectedId={null} onSelect={() => {}} scrollResetKey="" />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(5);
  });
  it("an unknown mode fails loudly instead of drawing nothing", () => {
    expect(() => render(<StudentList mode={"nope" as ListMode} students={[]} selectedId={null} onSelect={() => {}} scrollResetKey="" />)).toThrow("Unhandled list mode: nope");
    // React logs the error it re-throws.
    // (the setup file would fail the test if we did not account for it)
    return import("../test/setup").then((m) => m.takeConsoleErrors());
  });
});
```

### `frontend/src/directory/Directory.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../api/types";
import { fakeFetcher, giveScrollerASize, makeStudents, withBroken } from "../test/fixtures";
import { getCounts, resetCounts } from "../perf/counters";
import { takeConsoleErrors } from "../test/setup";
import { Directory } from "./Directory";

async function ready(fetcher: Fetcher, props: Partial<React.ComponentProps<typeof Directory>> = {}) {
  giveScrollerASize();
  render(<Directory fetcher={fetcher} {...props} />);
  await screen.findByText(/Showing/);
}
const summary = () => screen.getByText(/^Showing/).textContent;

describe("loading and failing", () => {
  it("says it is loading first", () => {
    render(<Directory fetcher={() => new Promise(() => {})} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading students");
  });

  it("shows the server's problem in plain words and lets the person try again", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new Error("Cannot reach the server. Is it running?")).mockResolvedValue({ students: makeStudents(5), queryCount: 1 });
    giveScrollerASize();
    render(<Directory fetcher={fetcher} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the server. Is it running?");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Showing 5 of 5/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a thrown non-Error still gives a readable message", async () => {
    render(<Directory fetcher={() => Promise.reject("nope")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("an aborted request shows nothing (we left the page)", async () => {
    const { unmount } = render(<Directory fetcher={() => Promise.reject(new DOMException("x", "AbortError"))} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
  });

  it("aborts the request when the page is closed", () => {
    let signal: AbortSignal | undefined;
    const fetcher: Fetcher = (s) => {
      signal = s;
      return new Promise(() => {});
    };
    const { unmount } = render(<Directory fetcher={fetcher} />);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("the list", () => {
  it("shows the count and the server's query count", async () => {
    await ready(fakeFetcher(makeStudents(300), 1));
    expect(summary()).toBe("Showing 300 of 300 students");
    expect(screen.getByText("The server ran 1 database query for this list.")).toBeInTheDocument();
  });
  it("says 'queries' when there is more than one", async () => {
    await ready(fakeFetcher(makeStudents(3), 5001));
    expect(screen.getByText("The server ran 5001 database queries for this list.")).toBeInTheDocument();
  });
  it("leaves the footnote out when the server did not say", async () => {
    await ready(fakeFetcher(makeStudents(3), null));
    expect(screen.queryByText(/database quer/)).not.toBeInTheDocument();
  });
  it("formats big numbers with commas", async () => {
    await ready(fakeFetcher(makeStudents(5000)));
    expect(summary()).toBe("Showing 5,000 of 5,000 students");
  });
  it("only about 20 of 5,000 rows are on the page", async () => {
    await ready(fakeFetcher(makeStudents(5000)));
    expect(screen.getAllByRole("listitem").length).toBeLessThan(25);
  });
  it("an empty server list says so", async () => {
    await ready(fakeFetcher([]));
    expect(screen.getByText("No student matches this search.")).toBeInTheDocument();
  });
});

describe("searching and filtering", () => {
  it("narrows by name and updates the count", async () => {
    await ready(fakeFetcher(makeStudents(200)));
    await userEvent.type(screen.getByLabelText("Search by name"), "aarav");
    expect(Number(/Showing (\d+) of 200/.exec(summary() ?? "")?.[1])).toBeLessThan(200);
    for (const li of screen.getAllByRole("listitem")) expect(li).toHaveTextContent(/aarav/i);
  });
  it("says so when nothing matches", async () => {
    await ready(fakeFetcher(makeStudents(50)));
    await userEvent.type(screen.getByLabelText("Search by name"), "zzzz");
    expect(screen.getByText("No student matches this search.")).toBeInTheDocument();
    expect(summary()).toBe("Showing 0 of 50 students");
  });
  it("filters by class", async () => {
    await ready(fakeFetcher(makeStudents(300)));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "8B");
    for (const li of screen.getAllByRole("listitem")) expect(li).toHaveTextContent("Class 8B");
  });
  it("sorts high to low", async () => {
    await ready(fakeFetcher(makeStudents(300)));
    await userEvent.selectOptions(screen.getByLabelText("Sort by score"), "desc");
    const scores = screen.getAllByRole("listitem").map((li) => Number(/(\d+)\s*$/.exec(li.textContent ?? "")?.[1]));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(100);
  });
  it("a search text longer than the field allows is refused with a message, and the list does not change", async () => {
    await ready(fakeFetcher(makeStudents(50)));
    const box = screen.getByLabelText("Search by name");
    expect(box).toHaveAttribute("maxlength", "50"); // the browser stops real typing at 50; this is the second line of defence
    fireEvent.change(box, { target: { value: "a".repeat(51) } }); // bypasses the browser's limit, as a script or a paste handler could
    expect(screen.getByRole("alert")).toHaveTextContent("Search by name: at most 50 characters");
    expect(box).toHaveAttribute("aria-describedby");
    expect((box as HTMLInputElement).value).toBe(""); // the refused text was NOT used
    expect(summary()).toBe("Showing 50 of 50 students");
    fireEvent.change(box, { target: { value: "aarav" } }); // the next good value clears the message
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows the broken-record notice and finds them with the checkbox", async () => {
    await ready(fakeFetcher(withBroken(makeStudents(50))));
    expect(takeConsoleErrors().length).toBeGreaterThanOrEqual(0);
    expect(screen.getByText(/4 records have a problem/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Show only broken records"));
    expect(summary()).toBe("Showing 4 of 50 students");
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    takeConsoleErrors();
  });
  it("says 'record has' for exactly one", async () => {
    const rows = makeStudents(10);
    rows[0] = { ...rows[0]!, name: null };
    await ready(fakeFetcher(rows));
    takeConsoleErrors();
    expect(screen.getByText(/1 record has a problem/)).toBeInTheDocument();
  });
  it("search words are matched case-insensitively and trimmed", async () => {
    await ready(fakeFetcher(makeStudents(100)));
    await userEvent.type(screen.getByLabelText("Search by name"), "  AARAV  ");
    expect(summary()).not.toBe("Showing 100 of 100 students");
  });
});

describe("the detail card", () => {
  it("opens for the clicked student and closes again", async () => {
    await ready(fakeFetcher(makeStudents(30)));
    await userEvent.click(screen.getAllByRole("button")[0 + 4]!); // skip: first buttons are rows (form has no buttons)
    const card = screen.getByRole("region", { name: "Student details" });
    expect(within(card).getByRole("heading", { level: 2 })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Student details" })).not.toBeInTheDocument();
  });
  it("marks the clicked row as pressed", async () => {
    await ready(fakeFetcher(makeStudents(30)));
    const row = screen.getAllByRole("button")[1]!;
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
  });
  it("a broken record's card shows a message and the list around it keeps working", async () => {
    const rows = makeStudents(30);
    rows[4] = { ...rows[4]!, score: "absent" }; // id 5: the row can still be clicked? no: it shows a warning instead of a button.
    await ready(fakeFetcher(rows));
    takeConsoleErrors();
    expect(screen.getAllByRole("alert")).toHaveLength(1); // the row warning
    // Other rows still select fine.
    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.getByRole("region", { name: "Student details" })).toBeInTheDocument();
  });
});

describe("speed rules, through the whole page", () => {
  it("memo mode: selecting a student redraws only the rows that changed (the Directory keeps onSelect stable)", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "memo" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().row).toBe(1);
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[5]!);
    expect(getCounts().row).toBe(2); // the old selection and the new one
  });
  it("plain mode: the same click redraws every row (this is the 'before')", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "plain" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().row).toBe(100);
  });
  it("the Directory itself draws once per real change, not once per row", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "memo" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().directory).toBe(1);
  });
});

describe("settings that are wrong", () => {
  it("switches the form off with the reasons, and the list still works", async () => {
    await ready(fakeFetcher(makeStudents(20)), { settings: [{ name: "query", type: "text" }] });
    expect(screen.getByRole("alert")).toHaveTextContent("The filter settings are not valid");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(summary()).toBe("Showing 20 of 20 students");
  });
  it("not even an array", async () => {
    await ready(fakeFetcher(makeStudents(5)), { settings: "nope" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(summary()).toBe("Showing 5 of 5 students");
  });
});

describe("list modes", () => {
  it.each(["plain", "memo-inline", "memo", "virtual", "virtual-deferred"] as const)("%s shows the same students", async (mode) => {
    await ready(fakeFetcher(makeStudents(40)), { listMode: mode });
    expect(screen.getAllByRole("button").length).toBeGreaterThan(5);
    await waitFor(() => expect(summary()).toBe("Showing 40 of 40 students"));
  });
});
```

### `frontend/src/api/students.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStudents } from "./students";

function answer(body: unknown, init: ResponseInit & { raw?: string } = {}): Response {
  return new Response(init.raw ?? JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}
function stub(fn: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fn));
}
afterEach(() => vi.unstubAllGlobals());

describe("fetchStudents", () => {
  it("asks for /api/students and returns the rows", async () => {
    stub(async () => answer([{ id: 1, name: "A", class_name: "6A", score: 5 }]));
    const result = await fetchStudents();
    expect(result.students).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/students", { signal: undefined });
  });
  it("reads the query count from the header", async () => {
    stub(async () => answer([], { headers: { "X-Query-Count": "1" } }));
    expect((await fetchStudents()).queryCount).toBe(1);
  });
  it.each([["abc"], ["-1"], ["1.5"], [""], ["1e3"]])("ignores a query count of %j", async (value) => {
    stub(async () => answer([], { headers: { "X-Query-Count": value } }));
    expect((await fetchStudents()).queryCount).toBeNull();
  });
  it("no header means null", async () => {
    stub(async () => answer([]));
    expect((await fetchStudents()).queryCount).toBeNull();
  });
  it("passes the abort signal on", async () => {
    stub(async () => answer([]));
    const controller = new AbortController();
    await fetchStudents(controller.signal);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });
  it("a network failure becomes a readable message", async () => {
    stub(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchStudents()).rejects.toThrow("Cannot reach the server. Is it running?");
  });
  it("an abort is passed through unchanged, not turned into a message", async () => {
    stub(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchStudents()).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([[404], [500], [503]])("status %i says the status", async (status) => {
    stub(async () => new Response("x", { status }));
    await expect(fetchStudents()).rejects.toThrow(`The server answered ${status}.`);
  });
  it("text that is not JSON is refused", async () => {
    stub(async () => answer(null, { raw: "<html>oops</html>" }));
    await expect(fetchStudents()).rejects.toThrow("not a student list");
  });
  it.each([[{ students: [] }], ["text"], [5], [null]])("JSON that is not a list (%j) is refused", async (body) => {
    stub(async () => answer(body));
    await expect(fetchStudents()).rejects.toThrow("not a student list");
  });
  it("a list with broken rows is still returned whole (each row is checked later)", async () => {
    stub(async () => answer([{ id: 1, name: null }, "junk", 5]));
    expect((await fetchStudents()).students).toHaveLength(3);
  });
});
```

### `frontend/src/App.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { giveScrollerASize, makeStudents } from "./test/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("reads the students from /api/students and shows them", async () => {
    giveScrollerASize();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(makeStudents(25)), { headers: { "X-Query-Count": "1" } })));
    render(<App />);
    expect(await screen.findByText("Showing 25 of 25 students")).toBeInTheDocument();
    expect(screen.getByText("The server ran 1 database query for this list.")).toBeInTheDocument();
  });
  it("shows a readable message when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<App />);
    expect(await screen.findByText("Cannot reach the server. Is it running?")).toBeInTheDocument();
  });
  it("junk entries in the list are shown as broken rows; the good ones still show", async () => {
    giveScrollerASize();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([...makeStudents(10), null, "junk"]))));
    render(<App />);
    expect(await screen.findByText("Showing 12 of 12 students")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    (await import("./test/setup")).takeConsoleErrors();
  });
  it("a list the page cannot read at all gives a message with a way to try again, never an endless 'Loading'", async () => {
    const rows: unknown[] = [];
    Object.defineProperty(rows, "0", { get() { throw new Error("unreadable"); } });
    rows.length = 1;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers(), json: async () => rows }) as unknown as Response));
    render(<App />);
    expect(await screen.findByText("The server sent a list the page could not read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
```

---

## 8. Results

| Check | Command | Result |
|---|---|---|
| Server tests | `python -m pytest -q` | **22 passed** |
| Page tests | `npm test` | **200 passed**; `npx tsc --noEmit` clean |
| Break it on purpose | `python break47.py` | first run 64 of 65; the one miss fixed and re-checked (see above) |
| Real browser | `npm run check:browser` | **15 of 15** passed: 15 rows and 121 elements on page; all 4 broken records show a warning; scroll to #5000; search resets scroll; server down, 500 and junk bodies show messages; gzip on |
| Queries | `python scripts/measure_queries.py` | before 5,001 queries, 27.9 ms; after 1 query, 4.9 ms |
| Speed | `npm run measure` | see the table in section 6; all six rules in `SLOW_DEFINITION.md` met by the virtual list |

---

## 9. Problems avoided

| Problem | Cause | Fix |
|---|---|---|
| Selecting one row redraws thousands | `memo` defeated by a new function each render | `useCallback`; test counts redraws |
| Still slow after `memo` | 25,000 elements to lay out | Virtual list |
| Virtual list draws nothing in tests | jsdom has no layout; the list measures `clientHeight` | Test helper gives the scroll box a size |
| One broken row blanks the page | Error thrown while drawing | Boundary around every row and the card |
| `null` entry in the list froze the page on Loading | Error thrown inside the promise handler | Entry becomes a broken row; handler has a catch |
| Console 404 for `/favicon.ico` | No icon declared | `<link rel="icon" href="data:,">` |
| Server processes left running after the browser script | `npx` starts a hidden child | Start Vite directly and stop the whole process group |

---

## 10. What was practiced

- Defining 'slow' with numbers before measuring
- Fixing one query per row with a JOIN and proving the count
- Virtualization, `memo`, `useCallback`, `useDeferredValue`, and measuring each honestly
- Error boundaries per part, and what they do not catch
- Zod to check settings and form values
- Union types and `assertNever`
- Real-browser checks with CPU throttling
- Breaking code on purpose to test the tests

---

## 11. Known limit

- **Windows was not tested.** Everything ran on Linux. The scripts have Windows branches (`python`, `taskkill`) that I wrote but never ran.
- **Only Chromium.** No Firefox or Safari, no real phone. '4x slower CPU' is an emulation.
- **Numbers come from one machine.** Compare rows with each other, not with other computers. 3 runs per row; a different run can vary by tens of percent.
- **The card's own error boundary cannot be reached through the page as built**: a broken row cannot be clicked, so only `StudentCard.test.tsx` covers it, not a full-page test. The page-level boundary in `App.tsx` is covered by the same boundary tests, but I did not find a way to make the real page crash on purpose, so that fallback was never seen in the real app.
- **Only the first full break-it run was complete (64/65).** The fixed case was re-run alone.
- Seed data is fake and always the same; real data may break in ways I did not predict.
- Not tested: more than 5,000 rows, screen readers (only the ARIA attributes are checked), and slow or lossy networks.

---

## 12. How to run it

```bash
# Windows PowerShell, from the folder that holds fast-student-directory.zip
Expand-Archive fast-student-directory.zip -DestinationPath .
cd fast-student-directory\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python -m pytest -q
python -m uvicorn app.main:create_app --factory --port 8000

# second PowerShell window
cd fast-student-directory\frontend
npm install
npm test
npm run dev          # open http://localhost:5173
```

Try `http://localhost:5173/?list=plain` and compare it with the normal page while typing in the search box. Add `&perf` and run `window.__perf.get()` in the console to see how many rows were redrawn.
For the browser scripts run `npx playwright install chromium` once, then `npm run check:browser` and `npm run measure`.
