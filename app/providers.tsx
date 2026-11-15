"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/lib/context/ToastContext";
import { ToastContainer } from "@/components/ui/toast-container";
import { ScreenReaderAnnouncerProvider } from "@/components/ui/ScreenReaderAnnouncer";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import "@/lib/stores/editorModeStore";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
        <ScreenReaderAnnouncerProvider>
          <ToastProvider>
            <TooltipPrimitive.Provider delayDuration={1500}>
              {children}
              <ToastContainer />
            </TooltipPrimitive.Provider>
          </ToastProvider>
        </ScreenReaderAnnouncerProvider>
      </QueryClientProvider>
  );
}
