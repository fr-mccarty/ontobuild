import { EntityTypeIcon } from "@/components/editor/shared/EntityTypeIcon";

/** The individual marker (purple diamond). Pass a size class such as "h-4 w-4". */
export function IndividualIcon({ className, tooltip }: { className?: string; tooltip?: boolean }) {
  return <EntityTypeIcon type="individual" className={className} tooltip={tooltip} />;
}
