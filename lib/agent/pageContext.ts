export const PAGE_TEXT_LIMIT = 30000;
export const PAGE_TEXT_TRUNCATED_MARKER = "[page text truncated]";
export const PAGE_TEXT_UNCHANGED = "Visible page text unchanged since the previous message.";

export interface AgentSelectedEntity {
  iri: string;
  type: string;
  label?: string | null;
}

export interface AgentPageInfo {
  projectId: string;
  projectName?: string;
  branch?: string;
  leftTab?: string;
  selectedEntity?: AgentSelectedEntity | null;
}

function elementText(el: Element): string {
  const html = el as HTMLElement;
  const text = typeof html.innerText === "string" ? html.innerText : el.textContent;
  return text ?? "";
}

export function collectVisibleText(root: Element, excludeSelector = "[data-agent-exclude]"): string {
  if (root.matches(excludeSelector)) return "";
  if (!root.querySelector(excludeSelector)) return elementText(root);
  const parts: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      if (t) parts.push(t);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const t = collectVisibleText(node as Element, excludeSelector);
      if (t.trim()) parts.push(t);
    }
  }
  return parts.join("\n");
}

export function readVisiblePageText(): string {
  if (typeof document === "undefined") return "";
  const main = document.getElementById("main-content");
  if (!main) return "";
  return collectVisibleText(main).replace(/\n{3,}/g, "\n\n").trim();
}

export function truncatePageText(text: string, limit = PAGE_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n${PAGE_TEXT_TRUNCATED_MARKER}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function buildPageContext(
  info: AgentPageInfo,
  lastPageText: string | null,
  env: { url: string; title: string; pageText: string },
): { context: string; pageText: string } {
  const pageText = truncatePageText(env.pageText);
  const lines: string[] = [
    `URL: ${env.url}`,
    `Page title: ${env.title}`,
    `Project: ${info.projectName ? `${info.projectName} ` : ""}(id: ${info.projectId})`,
    `Branch: ${info.branch ?? "default"}`,
  ];
  if (info.leftTab) lines.push(`Left sidebar tab: ${capitalize(info.leftTab)}`);
  const sel = info.selectedEntity;
  if (sel) {
    lines.push(`Selected entity: ${sel.label ? `${sel.label} ` : ""}<${sel.iri}> (type: ${sel.type})`);
  } else {
    lines.push("Selected entity: none");
  }
  if (lastPageText !== null && lastPageText === pageText) {
    lines.push(PAGE_TEXT_UNCHANGED);
  } else {
    lines.push("Visible page text:", pageText || "(empty)");
  }
  return { context: lines.join("\n"), pageText };
}

export function buildPageContextFromDocument(info: AgentPageInfo, lastPageText: string | null) {
  const hasWindow = typeof window !== "undefined";
  return buildPageContext(info, lastPageText, {
    url: hasWindow ? window.location.href : "",
    title: typeof document !== "undefined" ? document.title : "",
    pageText: readVisiblePageText(),
  });
}
