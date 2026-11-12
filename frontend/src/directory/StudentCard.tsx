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
