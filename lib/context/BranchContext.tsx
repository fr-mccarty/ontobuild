"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  branchesApi,
  type BranchInfo,
} from "@/lib/api/revisions";

export const branchQueryKeys = {
  list: (projectId: string, accessToken?: string) => ["branches", projectId, !!accessToken] as const,
};

function getStoredBranch(projectId: string): string | null {
  try {
    return sessionStorage.getItem(`ontokit:branch:${projectId}`);
  } catch {
    return null;
  }
}

function setStoredBranch(projectId: string, branch: string): void {
  try {
    sessionStorage.setItem(`ontokit:branch:${projectId}`, branch);
  } catch {
  }
}

interface BranchContextValue {
  branches: BranchInfo[];
  currentBranch: string;
  defaultBranch: string;
  isLoading: boolean;
  error: string | null;
  isFeatureBranch: boolean;
  pendingChanges: boolean;

  refreshBranches: () => Promise<void>;
  createBranch: (name: string, fromBranch?: string) => Promise<BranchInfo>;
  switchBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  setPendingChanges: (pending: boolean) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

interface BranchProviderProps {
  projectId: string;
  accessToken?: string;
  initialBranch?: string;
  children: ReactNode;
}

export function BranchProvider({
  projectId,
  accessToken,
  initialBranch,
  children,
}: BranchProviderProps) {
  const queryClient = useQueryClient();

  const {
    data: response,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: branchQueryKeys.list(projectId, accessToken),
    queryFn: () => branchesApi.list(projectId, accessToken),
    enabled: !!projectId,
  });

  const branches = useMemo(() => response?.items ?? [], [response?.items]);
  const defaultBranch = response?.default_branch ?? "main";
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Failed to load branches"
    : null;

  const [currentBranch, setCurrentBranch] = useState<string>(
    () => initialBranch || getStoredBranch(projectId) || "main"
  );
  const [pendingChanges, setPendingChanges] = useState(false);

  const isFeatureBranch = currentBranch !== defaultBranch;

  useEffect(() => {
    if (!response) return;
    setCurrentBranch((prev) => {
      if (!accessToken) return response.default_branch ?? response.current_branch;

      const prevExists = response.items.some((b) => b.name === prev);
      if (prevExists) return prev;
      try {
        sessionStorage.removeItem(`ontokit:branch:${projectId}`);
      } catch {
      }
      const prefExists =
        response.preferred_branch &&
        response.items.some((b) => b.name === response.preferred_branch);
      return prefExists
        ? response.preferred_branch!
        : response.current_branch;
    });
  }, [response, projectId, accessToken]);

  const [initialBranchHandled, setInitialBranchHandled] = useState(false);
  useEffect(() => {
    if (
      accessToken &&
      initialBranch &&
      !initialBranchHandled &&
      !isLoading &&
      branches.length > 0
    ) {
      const branchExists = branches.some((b) => b.name === initialBranch);
      if (branchExists && initialBranch !== currentBranch) {
        setCurrentBranch(initialBranch);
      }
      setInitialBranchHandled(true);
    }
  }, [accessToken, initialBranch, initialBranchHandled, isLoading, branches, currentBranch]);

  const refreshBranches = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: branchQueryKeys.list(projectId, accessToken),
    });
  }, [queryClient, projectId, accessToken]);

  const createBranch = useCallback(
    async (name: string, fromBranch?: string): Promise<BranchInfo> => {
      if (!accessToken) {
        throw new Error("Authentication required");
      }

      const newBranch = await branchesApi.create(
        projectId,
        { name, from_branch: fromBranch },
        accessToken
      );

      await refreshBranches();

      setCurrentBranch(name);
      setStoredBranch(projectId, name);
      branchesApi.savePreference(projectId, name, accessToken).catch(() => {});

      return newBranch;
    },
    [projectId, accessToken, refreshBranches]
  );

  const switchBranch = useCallback(
    async (name: string) => {
      if (!accessToken) {
        throw new Error("Authentication required to switch branches");
      }

      if (pendingChanges) {
        throw new Error(
          "You have pending changes. Please commit or discard them before switching branches."
        );
      }

      const branchExists = branches.some((b) => b.name === name);
      if (!branchExists) {
        throw new Error(`Branch not found: ${name}`);
      }

      setCurrentBranch(name);
      setStoredBranch(projectId, name);

      branchesApi.savePreference(projectId, name, accessToken).catch(() => {});
    },
    [branches, pendingChanges, projectId, accessToken]
  );

  const deleteBranch = useCallback(
    async (name: string, force = false) => {
      if (!accessToken) {
        throw new Error("Authentication required");
      }

      if (name === currentBranch) {
        throw new Error("Cannot delete the current branch");
      }

      if (name === defaultBranch) {
        throw new Error("Cannot delete the default branch");
      }

      await branchesApi.delete(projectId, name, accessToken, force);

      await refreshBranches();
    },
    [projectId, accessToken, currentBranch, defaultBranch, refreshBranches]
  );

  const value: BranchContextValue = {
    branches,
    currentBranch,
    defaultBranch,
    isLoading,
    error,
    isFeatureBranch,
    pendingChanges,
    refreshBranches,
    createBranch,
    switchBranch,
    deleteBranch,
    setPendingChanges,
  };

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}
