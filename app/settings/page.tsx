"use client";

import Link from "next/link";
import { ArrowLeft, Sun, Moon, Monitor, Save } from "lucide-react";
import { Header } from "@/components/layout/header";
import { SettingsSection, SettingsField } from "@/components/settings/SettingsSection";
import { SegmentedChoice, type SegmentedChoiceOption } from "@/components/settings/SegmentedChoice";
import { OptionCard } from "@/components/settings/OptionCard";
import { AgentSettingsSection } from "@/components/settings/AgentSettingsSection";
import { useHashHighlight } from "@/components/settings/useHashHighlight";
import {
  usePreferencesStore,
  type ThemePreference,
} from "@/lib/stores/preferencesStore";

export default function UserSettingsPage() {
  const highlightedSetting = useHashHighlight();

  return (
    <>
      <Header />
      <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to projects
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Settings
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Manage your editor and agent preferences
            </p>
          </div>

          <div className="space-y-6">
            <EditorPreferencesSection highlightedSetting={highlightedSetting} />
            <AgentSettingsSection highlighted={highlightedSetting === "agent"} />
          </div>
        </div>
      </main>
    </>
  );
}

const themeOptions: SegmentedChoiceOption<ThemePreference>[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function EditorPreferencesSection({ highlightedSetting }: { highlightedSetting: string | null }) {
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const hideSaveButton = usePreferencesStore((s) => s.hideSaveButton);
  const setHideSaveButton = usePreferencesStore((s) => s.setHideSaveButton);

  return (
    <SettingsSection
      title="Editor Preferences"
      description="Choose your preferred theme and save behavior."
    >
      <SettingsField labelId="theme-label" label="Theme" className="mx-0 p-0">
        <SegmentedChoice labelledBy="theme-label" options={themeOptions} value={theme} onChange={setTheme} />
      </SettingsField>

      <SettingsField
        id="save-button"
        labelId="hide-save-button-label"
        label="Hide Save Now"
        highlighted={highlightedSetting === "save-button"}
        className="mt-6"
      >
        <OptionCard
          role="switch"
          aria-checked={hideSaveButton}
          aria-labelledby="hide-save-button-label"
          onClick={() => setHideSaveButton(!hideSaveButton)}
          selected={hideSaveButton}
          icon={Save}
          title={hideSaveButton ? "On" : "Off"}
          description="Hide the Save now action in the editor's save status menu. Edits still save automatically when you select another entity or leave the page."
        />
      </SettingsField>
    </SettingsSection>
  );
}
