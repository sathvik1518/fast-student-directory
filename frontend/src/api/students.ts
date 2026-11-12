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
