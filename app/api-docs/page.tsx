"use client";

import { useEffect } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import "./scalar-overrides.css";
import { Header } from "@/components/layout/header";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

function useSyncScalarDarkMode() {
  useEffect(() => {
    const root = document.documentElement;

    function sync() {
      const isDark = root.classList.contains("dark");
      document.body.classList.toggle("dark-mode", isDark);
      document.body.classList.toggle("light-mode", !isDark);
    }

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
}

export default function ApiDocsPage() {
  useSyncScalarDarkMode();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="scalar-container min-h-0 flex-1">
        <ApiReferenceReact
          configuration={{
            url: `${API_BASE_URL}/api/v1/openapi.json`,
            servers: [{ url: API_BASE_URL || "/" }],
            theme: "none",
            withDefaultFonts: false,
            hideModels: false,
            hideDownloadButton: false,
            hideDarkModeToggle: true,
            showDeveloperTools: "never",
            agent: { disabled: true },
            mcp: { disabled: true },
            hideClientButton: true,
            hideTestRequestButton: true,
            metaData: {
              title: "OntoKit API Documentation",
            },
          }}
        />
      </div>
    </div>
  );
}
