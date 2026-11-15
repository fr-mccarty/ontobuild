import { langToFlag } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

interface LanguageFlagProps {
  lang: string;
  className?: string;
}

export function LanguageFlag({ lang, className }: LanguageFlagProps) {
  const flag = lang ? langToFlag(lang) : null;

  return (
    <Tooltip content={lang || undefined}>
      <span
        role={flag ? "img" : undefined}
        aria-label={flag ? `Language: ${lang}` : undefined}
        aria-hidden={!flag ? true : undefined}
        className={className ?? "inline-flex h-5 w-5 shrink-0 items-center justify-center font-emoji text-sm leading-none"}
      >
        {flag}
      </span>
    </Tooltip>
  );
}
