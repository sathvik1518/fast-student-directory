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
