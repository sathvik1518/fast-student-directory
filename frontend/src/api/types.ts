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
