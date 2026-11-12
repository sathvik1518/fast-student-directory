import { MemoInlineList, MemoList } from "./lists/MemoList";
import { PlainList } from "./lists/PlainList";
import type { ListProps } from "./lists/types";
import { VirtualList } from "./lists/VirtualList";

/** The list can be drawn five ways. Only 'virtual' is the real page. The other four exist so the before/after numbers can be repeated:
 *  open the page with ?list=plain (or memo-inline, memo, virtual-deferred). */
export const LIST_MODES = ["plain", "memo-inline", "memo", "virtual", "virtual-deferred"] as const;
export type ListMode = (typeof LIST_MODES)[number];

export function parseListMode(search: string): ListMode {
  const wanted = new URLSearchParams(search).get("list");
  return LIST_MODES.find((m) => m === wanted) ?? "virtual";
}

export type StudentListProps = ListProps & { mode: ListMode };

export function StudentList({ mode, ...props }: StudentListProps) {
  switch (mode) {
    case "plain":
      return <PlainList {...props} />;
    case "memo-inline":
      return <MemoInlineList {...props} />;
    case "memo":
      return <MemoList {...props} />;
    case "virtual":
    case "virtual-deferred":
      return <VirtualList {...props} />;
    default:
      return assertNever(mode);
  }
}

/** If a new mode is added to LIST_MODES and not handled above, this line stops the build (TypeScript error), not the user. */
function assertNever(value: never): never {
  throw new Error(`Unhandled list mode: ${String(value)}`);
}
