// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sectionHelp } from "@/lib/editor/sectionHelp";

const PANELS = ["ClassDetailPanel.tsx", "PropertyDetailPanel.tsx", "IndividualDetailPanel.tsx"];

describe("sectionHelp", () => {
  it("explains every section label in the entity panels", () => {
    const titles = new Set<string>();
    for (const file of PANELS) {
      const source = fs.readFileSync(path.join(process.cwd(), "components/editor", file), "utf8");
      for (const m of source.matchAll(/<Section\s+title="([^"]+)"/g)) titles.add(m[1]);
    }
    expect(titles.size).toBeGreaterThan(15);
    expect([...titles].filter((t) => !sectionHelp(t))).toEqual([]);
  });

  it("falls back to the given text for an unknown label", () => {
    expect(sectionHelp("Something new", "ex:term")).toBe("ex:term");
    expect(sectionHelp("Something new")).toBeUndefined();
  });
});
