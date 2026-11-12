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
