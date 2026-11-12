import { describe, expect, it } from "vitest";
import type { RawStudent } from "../api/types";
import { BrokenRecordError, describeProblem, indexStudents, readStudent, scoreBand } from "./records";

const good: RawStudent = { id: 1, name: "Aarav Reddy", class_name: "8B", score: 77 };

describe("describeProblem", () => {
  it("is null for a good record", () => expect(describeProblem(good)).toBeNull());
  it.each([
    [{ ...good, name: null }, "the name is missing"],
    [{ ...good, name: 12345 }, "the name is not text"],
    [{ ...good, name: "" }, "the name is empty"],
    [{ ...good, name: "   " }, "the name is empty"],
    [{ ...good, score: "absent" }, "the score is not a number"],
    [{ ...good, score: null }, "the score is not a number"],
    [{ ...good, score: Number.NaN }, "the score is not a number"],
    [{ ...good, score: Number.POSITIVE_INFINITY }, "the score is not a number"],
    [{ ...good, class_name: null }, "the class is missing"],
    [{ ...good, class_name: "" }, "the class is missing"],
  ] as [RawStudent, string][])("says what is wrong (%#)", (raw, expected) => expect(describeProblem(raw)).toBe(expected));

  it("a score of 0 is fine", () => expect(describeProblem({ ...good, score: 0 })).toBeNull());
  it("reports the first problem when several are wrong", () => expect(describeProblem({ id: 3, name: null, class_name: null, score: "x" })).toBe("the name is missing"));
});

describe("readStudent", () => {
  it("returns a clean Student", () => expect(readStudent(good)).toEqual({ id: 1, name: "Aarav Reddy", className: "8B", score: 77 }));
  it("throws BrokenRecordError with the id and the problem", () => {
    try {
      readStudent({ ...good, id: 7, name: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrokenRecordError);
      expect((error as BrokenRecordError).studentId).toBe(7);
      expect((error as BrokenRecordError).problem).toBe("the name is missing");
      expect((error as Error).message).toBe("Student #7: the name is missing");
    }
  });
});

describe("indexStudents", () => {
  it("works out the search key, the numeric score and the problem once", () => {
    const [a, b, c] = indexStudents([good, { ...good, id: 2, name: null, score: "x" }, { ...good, id: 3, name: "ÀB Çd" }]);
    expect(a).toMatchObject({ nameKey: "aarav reddy", scoreValue: 77, problem: null });
    expect(b).toMatchObject({ nameKey: "", scoreValue: null, problem: "the name is missing" });
    expect(c?.nameKey).toBe("àb çd");
  });
  it("keeps the original row untouched and in the same order", () => {
    const rows = [good, { ...good, id: 2 }];
    const out = indexStudents(rows);
    expect(out.map((s) => s.raw)).toEqual(rows);
    expect(out[0]?.raw).toBe(rows[0]);
  });
});

describe("scoreBand", () => {
  it.each([[100, "Excellent"], [90, "Excellent"], [89, "Good"], [75, "Good"], [74, "Fair"], [50, "Fair"], [49, "Needs support"], [0, "Needs support"]])("%i is %s", (score, band) =>
    expect(scoreBand(score)).toBe(band),
  );
});

describe("indexStudents with rows that are not objects", () => {
  it.each([[null], ["junk"], [5], [[1, 2]], [undefined]])("turns %j into a broken row instead of crashing", (junk) => {
    const out = indexStudents([{ id: 1, name: "A", class_name: "6A", score: 5 }, junk, { id: 2, name: "B", class_name: "6A", score: 6 }]);
    expect(out).toHaveLength(3);
    expect(out[1]?.problem).toBe("the name is missing");
    expect(out[1]?.raw.id).toBe(-2);
    expect(out[0]?.problem).toBeNull();
    expect(out[2]?.problem).toBeNull();
  });
});
