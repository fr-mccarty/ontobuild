"use client";

import { useEffect, useState } from "react";

export function useHashHighlight(durationMs = 2000) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: el.tagName === "SECTION" ? "start" : "center" });
      setHighlighted(hash);
      timer = setTimeout(() => setHighlighted(null), durationMs);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [durationMs]);

  return highlighted;
}
