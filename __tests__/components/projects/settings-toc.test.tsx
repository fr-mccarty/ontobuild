import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsToc } from "@/components/projects/settings-toc";

const items = [
  { id: "general", label: "General" },
  { id: "normalization", label: "Ontology Normalization", attention: true },
  { id: "danger-zone", label: "Danger Zone", danger: true },
];

function renderWithSections() {
  return render(
    <>
      <SettingsToc items={items} />
      {items.map((i) => (
        <section key={i.id} id={i.id} />
      ))}
    </>,
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SettingsToc", () => {
  it("links every section and flags the ones that need attention", () => {
    renderWithSections();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["#general", "#normalization", "#danger-zone"]);
    expect(within(links[1]).getByRole("img", { name: "needs attention" })).toBeDefined();
    expect(within(links[0]).queryByRole("img")).toBeNull();
  });

  it("scrolls to the section on click and keeps the query string in the URL", () => {
    window.history.replaceState(null, "", "/projects/p1/settings?branch=main");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWithSections();
    fireEvent.click(screen.getByRole("link", { name: /Ontology Normalization/ }));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById("normalization"));
    expect(window.location.search).toBe("?branch=main");
    expect(window.location.hash).toBe("#normalization");
  });

  it("scrolls to the URL's section once rendered", () => {
    window.history.replaceState(null, "", "/projects/p1/settings#danger-zone");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWithSections();
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("danger-zone"));
  });
});
