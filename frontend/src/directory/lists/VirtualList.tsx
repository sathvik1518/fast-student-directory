import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef } from "react";
import { ROW_HEIGHT, RowItem } from "../StudentRow";
import type { ListProps } from "./types";

export const LIST_HEIGHT = 480;
const MemoRowItem = memo(RowItem);

/** AFTER: only the rows you can see (plus a few above and below) exist on the page. 5,000 students, about 20 rows.
 *  The scroll bar still has the full height, so it feels like one long list. */
export function VirtualList({ students, selectedId, onSelect, scrollResetKey }: ListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: students.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    getItemKey: (index) => students[index]?.raw.id ?? index,
  });

  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [scrollResetKey, virtualizer]);

  return (
    <div ref={scrollerRef} className="scroller" style={{ height: LIST_HEIGHT }} role="region" aria-label="Student list" tabIndex={0}>
      <div role="list" aria-label="Students" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const student = students[item.index];
          if (!student) return null;
          return (
            <div
              key={item.key}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={students.length}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <MemoRowItem student={student} selected={student.raw.id === selectedId} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
