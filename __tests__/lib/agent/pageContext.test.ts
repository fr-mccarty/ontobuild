import { describe, it, expect, afterEach } from "vitest";
import {
  buildPageContext,
  collectVisibleText,
  PAGE_TEXT_TRUNCATED_MARKER,
  PAGE_TEXT_UNCHANGED,
  truncatePageText,
} from "@/lib/agent/pageContext";

const env = { url: "http://localhost/projects/p1", title: "OntoKit", pageText: "Dog\nAnimal" };
const info = {
  projectId: "p1",
  projectName: "Zoo",
  branch: "main",
  leftTab: "classes",
  selectedEntity: { iri: "http://ex.org/Dog", type: "class", label: "Dog" },
};

describe("pageContext", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("includes url, project, branch, tab, selection and page text", () => {
    const { context, pageText } = buildPageContext(info, null, env);
    expect(context).toContain("URL: http://localhost/projects/p1");
    expect(context).toContain("Page title: OntoKit");
    expect(context).toContain("Project: Zoo (id: p1)");
    expect(context).toContain("Branch: main");
    expect(context).toContain("Left sidebar tab: Classes");
    expect(context).toContain("Selected entity: Dog <http://ex.org/Dog> (type: class)");
    expect(context).toContain("Visible page text:\nDog\nAnimal");
    expect(pageText).toBe("Dog\nAnimal");
  });

  it("says the text is unchanged when it matches the last context", () => {
    const { context } = buildPageContext(info, "Dog\nAnimal", env);
    expect(context).toContain(PAGE_TEXT_UNCHANGED);
    expect(context).not.toContain("Visible page text:");
    expect(context).toContain("Selected entity:");
  });

  it("truncates long page text with a marker", () => {
    const t = truncatePageText("x".repeat(40), 10);
    expect(t).toBe(`${"x".repeat(10)}\n${PAGE_TEXT_TRUNCATED_MARKER}`);
  });

  it("excludes nodes marked data-agent-exclude", () => {
    document.body.innerHTML =
      '<main id="main-content"><div>Header</div><div><section>Tree</section><aside data-agent-exclude>Chat secret</aside></div></main>';
    const text = collectVisibleText(document.getElementById("main-content")!);
    expect(text).toContain("Header");
    expect(text).toContain("Tree");
    expect(text).not.toContain("Chat secret");
  });
});
