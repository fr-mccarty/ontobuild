import { vi } from "vitest";
import React from "react";

export function nextNavigationMock(overrides?: {
  pathname?: string;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
}) {
  const push = vi.fn();
  const replace = vi.fn();
  const back = vi.fn();
  const searchParams = new URLSearchParams(overrides?.searchParams);

  return {
    useRouter: () => ({ push, replace, back, refresh: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => overrides?.pathname ?? "/",
    useParams: () => overrides?.params ?? {},
    useSearchParams: () => searchParams,
    redirect: vi.fn(),
    notFound: vi.fn(),
    __push: push,
    __replace: replace,
    __back: back,
  };
}

export const nextLinkMock = {
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("a", { href, ...props }, children),
};
