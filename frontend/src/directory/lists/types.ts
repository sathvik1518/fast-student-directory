import type { IndexedStudent } from "../records";

export type ListProps = {
  students: readonly IndexedStudent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** When this text changes (a new search, class or sort) the list jumps back to the top. */
  scrollResetKey: string;
};
