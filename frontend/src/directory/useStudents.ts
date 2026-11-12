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
