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
