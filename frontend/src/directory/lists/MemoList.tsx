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
