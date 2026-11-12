import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getCounts, resetCounts } from "../../perf/counters";
import { giveScrollerASize, makeStudents } from "../../test/fixtures";
import { takeConsoleErrors } from "../../test/setup";
import { indexStudents } from "../records";
import { MemoInlineList, MemoList } from "./MemoList";
import { PlainList } from "./PlainList";
import type { ListProps } from "./types";
import { VirtualList } from "./VirtualList";

const all = indexStudents(makeStudents(200));

/** jsdom cannot scroll; this records the position the list asks the scroll box to go to. */
function watchScrollTo(scroller: HTMLElement, asked: number[]): void {
  scroller.scrollTo = ((a?: number | ScrollToOptions) => {
    asked.push(typeof a === "object" ? (a.top ?? 0) : (a ?? 0));
  }) as typeof scroller.scrollTo;
}
const base = (patch: Partial<ListProps> = {}): ListProps => ({ students: all, selectedId: null, onSelect: () => {}, scrollResetKey: "", ...patch });

/** Draw the list, then change what it shows (as a search would), and count how many rows had to be drawn again. */
function rowsRedrawnAfter(List: (p: ListProps) => React.ReactElement, change: (p: ListProps) => ListProps): number {
  const onSelect = () => {};
  const { rerender } = render(<List {...base({ onSelect })} />);
  resetCounts();
  rerender(<List {...change(base({ onSelect }))} />);
  return getCounts().row ?? 0;
}

describe("how many rows redraw when the search narrows 200 students to 150", () => {
  const narrow = (p: ListProps): ListProps => ({ ...p, students: p.students.slice(0, 150) });
  it("plain: all 150 draw again", () => expect(rowsRedrawnAfter(PlainList, narrow)).toBe(150));
  it("memo with a new inline function each time: still all 150 (memo does nothing)", () => expect(rowsRedrawnAfter(MemoInlineList, narrow)).toBe(150));
  it("memo with the same function each time: none", () => expect(rowsRedrawnAfter(MemoList, narrow)).toBe(0));
});

describe("how many rows redraw when one student is selected", () => {
  const select = (p: ListProps): ListProps => ({ ...p, selectedId: 5 });
  it("plain: all 200", () => expect(rowsRedrawnAfter(PlainList, select)).toBe(200));
  it("memo with an inline function: all 200", () => expect(rowsRedrawnAfter(MemoInlineList, select)).toBe(200));
  it("memo with a stable function: only the one that changed", () => expect(rowsRedrawnAfter(MemoList, select)).toBe(1));
  it("memo: moving the selection redraws exactly two rows (the old and the new)", () => {
    const onSelect = () => {};
    const { rerender } = render(<MemoList {...base({ onSelect, selectedId: 5 })} />);
    resetCounts();
    rerender(<MemoList {...base({ onSelect, selectedId: 9 })} />);
    expect(getCounts().row).toBe(2);
  });
});

describe("the plain lists", () => {
  it.each([["plain", PlainList], ["memo", MemoList], ["memo-inline", MemoInlineList]] as const)("%s puts every row on the page", (_n, List) => {
    render(<List {...base()} />);
    expect(screen.getAllByRole("button")).toHaveLength(200);
  });
});

describe("VirtualList", () => {
  const big = indexStudents(makeStudents(5000));

  it("puts about 20 rows on the page, not 5,000", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.length).toBeLessThanOrEqual(25);
    expect(rows[0]).toHaveTextContent(/Rohan Naidu 5000|Diya Goud 1|Aarav/);
  });

  it("still tells screen readers there are 5,000 items and which one each is", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const first = screen.getAllByRole("listitem")[0]!;
    expect(first).toHaveAttribute("aria-setsize", "5000");
    expect(first).toHaveAttribute("aria-posinset", "1");
  });

  it("places each row where it belongs: row number x 56 px from the top", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    for (const li of screen.getAllByRole("listitem")) {
      const index = Number(li.getAttribute("aria-posinset")) - 1;
      expect(li.style.transform).toBe(`translateY(${index * 56}px)`);
      expect(li.style.height).toBe("56px");
    }
  });

  it("keeps the full scroll height so the scroll bar is honest", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    expect(screen.getByRole("list")).toHaveStyle({ height: `${5000 * 56}px` });
  });

  it("shows later rows after scrolling", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    act(() => {
      scroller.scrollTop = 56 * 2500;
      fireEvent.scroll(scroller);
    });
    const positions = screen.getAllByRole("listitem").map((li) => Number(li.getAttribute("aria-posinset")));
    expect(Math.min(...positions)).toBeGreaterThan(2400);
    expect(Math.max(...positions)).toBeLessThan(2600);
    expect(screen.queryByText(/ 1$/)).not.toBeInTheDocument();
  });

  it("draws fewer rows when there are fewer students", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: all.slice(0, 3) })} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("a click on a visible row selects that student", () => {
    giveScrollerASize();
    const onSelect = vi.fn();
    render(<VirtualList {...base({ students: big, onSelect })} />);
    fireEvent.click(screen.getAllByRole("button")[2]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a broken record in view costs one row; the others still draw", () => {
    giveScrollerASize();
    const rows = makeStudents(30);
    rows[2] = { ...rows[2]!, name: null };
    render(<VirtualList {...base({ students: indexStudents(rows) })} />);
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(8);
  });

  it("selecting redraws only the rows whose selected flag changed", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect })} />);
    resetCounts();
    rerender(<VirtualList {...base({ students: big, onSelect, selectedId: 3 })} />);
    expect(getCounts().row).toBe(1);
  });

  it("goes back to the top when the search changes (scrollResetKey)", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a" })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    // jsdom has no scrolling; record what the list asks for.
    const asked: number[] = [];
    watchScrollTo(scroller, asked);
    act(() => {
      scroller.scrollTop = 56 * 1000;
      fireEvent.scroll(scroller);
    });
    asked.length = 0;
    rerender(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "b" })} />);
    expect(asked).toContain(0);
  });

  it("does not jump to the top when only the selection changes", () => {
    giveScrollerASize();
    const onSelect = () => {};
    const { rerender } = render(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a" })} />);
    const scroller = screen.getByRole("region", { name: "Student list" });
    const asked: number[] = [];
    watchScrollTo(scroller, asked);
    rerender(<VirtualList {...base({ students: big, onSelect, scrollResetKey: "a", selectedId: 4 })} />);
    expect(asked).toEqual([]);
  });

  it("is labelled, and the scroll box can be reached with the keyboard", () => {
    giveScrollerASize();
    render(<VirtualList {...base({ students: big })} />);
    expect(screen.getByRole("region", { name: "Student list" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("list", { name: "Students" })).toBeInTheDocument();
  });
});
