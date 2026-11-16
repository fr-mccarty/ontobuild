import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getLocalName(iri: string): string {
  const hashIndex = iri.lastIndexOf("#");
  if (hashIndex !== -1) {
    return iri.substring(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf("/");
  if (slashIndex !== -1) {
    return iri.substring(slashIndex + 1);
  }
  return iri;
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getPreferredLabel(labels: { value: string }[]): string {
  return labels.find((l) => l.value.trim())?.value ?? "";
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

