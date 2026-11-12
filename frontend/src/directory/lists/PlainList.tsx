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
