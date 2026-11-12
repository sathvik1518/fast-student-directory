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
