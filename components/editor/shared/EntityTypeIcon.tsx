import { Circle, CircleHelp, Diamond, RectangleHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Tooltip, TOOLTIP_DELAY_MS } from "@/components/ui/tooltip";

/**
 * OntoBuild's visual language: every entity kind has exactly one shape and one color,
 * used on every screen. The shape carries the meaning on its own (it reads in grayscale and
 * for color-blind users); the color reinforces it.
 *
 * The source of truth for these markers is the OntoBuild ontology (ob:EntityMarker and its
 * individuals). Keep the values here in step with it.
 *
 *   Class       circle           amber
 *   Property    horizontal bar   blue
 *   Individual  diamond          purple
 *   Other       circle + "?"     slate
 */
export type MarkedEntityType = "class" | "property" | "individual" | "other";

interface EntityMarker {
  icon: LucideIcon;
  label: string;
  /** Plain-language meaning, as in the OntoBuild ontology's marker comments. */
  meaning: string;
  className: string;
}

export const ENTITY_MARKERS: Record<MarkedEntityType, EntityMarker> = {
  class: {
    icon: Circle,
    label: "Class",
    meaning: "A category or type of thing",
    className: "fill-amber-200 text-amber-600 dark:fill-amber-900/60 dark:text-amber-400",
  },
  property: {
    icon: RectangleHorizontal,
    label: "Property",
    meaning: "A relationship or attribute connecting things",
    className: "fill-blue-200 text-blue-600 dark:fill-blue-900/60 dark:text-blue-400",
  },
  individual: {
    icon: Diamond,
    label: "Individual",
    meaning: "A specific instance of a class",
    className: "fill-purple-200 text-purple-600 dark:fill-purple-900/60 dark:text-purple-400",
  },
  other: {
    icon: CircleHelp,
    label: "Other",
    meaning: "An entity whose kind could not be determined",
    className: "text-slate-500 dark:text-slate-400",
  },
};

export function markerFor(type: string | null | undefined): EntityMarker {
  return ENTITY_MARKERS[(type ?? "other") as MarkedEntityType] ?? ENTITY_MARKERS.other;
}

/**
 * Popover text naming an entity's kind and what it means, with its IRI underneath when given.
 * Use it as the content of a row's existing Tooltip, so the row shows one popover, not two.
 */
export function EntityTypeTooltipContent({ type, iri }: { type: string | null | undefined; iri?: string }): ReactNode {
  const marker = markerFor(type);
  return (
    <span className="block">
      <span className="flex items-center gap-1.5 font-semibold">
        <EntityTypeIcon type={type} className="h-3.5 w-3.5" tooltip={false} />
        {marker.label}
      </span>
      <span className="block opacity-80">{marker.meaning}</span>
      {iri && <span className="mt-1 block break-all opacity-70">{iri}</span>}
    </span>
  );
}

/**
 * The marker for an entity kind. Pass a size class such as "h-4 w-4". Hovering it shows a
 * popover with the entity kind; pass tooltip={false} when the surrounding row already has a
 * popover (put EntityTypeTooltipContent in that one instead).
 */
export function EntityTypeIcon({
  type,
  className,
  tooltip = true,
}: {
  type: string | null | undefined;
  className?: string;
  tooltip?: boolean;
}) {
  const marker = markerFor(type);
  const Icon = marker.icon;
  const known = (type ?? "other") in ENTITY_MARKERS ? (type ?? "other") : "other";
  const icon = (
    <Icon
      className={cn("shrink-0", marker.className, className ?? "h-4 w-4")}
      role="img"
      aria-label={marker.label}
      data-testid={`${known}-icon`}
    />
  );
  if (!tooltip) return icon;
  // Its own provider, so the icon works wherever it renders (graph nodes, portals, tests),
  // with the same delay as the app-wide one.
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <Tooltip content={<EntityTypeTooltipContent type={type} />}>
        <span className="inline-flex shrink-0">{icon}</span>
      </Tooltip>
    </TooltipPrimitive.Provider>
  );
}
