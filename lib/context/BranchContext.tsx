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
  list: (projectId: string) => ["branches", projectId] as const,
};

function getStoredBranch(projectId: string): string | null {
  try {
    return sessionStorage.getItem(`ontobuilder:branch:${projectId}`);
  } catch {
    return null;
  }
}

function setStoredBranch(projectId: string, branch: string): void {
  try {
    sessionStorage.setItem(`ontobuilder:branch:${projectId}`, branch);
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
  initialBranch?: string;
  children: ReactNode;
}

export function BranchProvider({
  projectId,
  initialBranch,
  children,
}: BranchProviderProps) {
  const queryClient = useQueryClient();

  const {
    data: response,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: branchQueryKeys.list(projectId),
    queryFn: () => branchesApi.list(projectId),
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

  // Reconcile the selected branch with each new branch-list response (and when the
  // project changes). Done while rendering — the "adjust state when inputs
  // change" pattern — so consumers never see an unreconciled branch.
  const [lastSync, setLastSync] = useState<{
    response: typeof response;
    projectId: string;
    clearStoredBranch: boolean;
  } | null>(null);
  if (
    lastSync === null ||
    lastSync.response !== response ||
    lastSync.projectId !== projectId
  ) {
    let clearStoredBranch = false;
    if (response) {
      let nextBranch: string;
      if (response.items.some((b) => b.name === currentBranch)) {
        nextBranch = currentBranch;
      } else {
        clearStoredBranch = true;
        const prefExists =
          response.preferred_branch &&
          response.items.some((b) => b.name === response.preferred_branch);
        nextBranch = prefExists ? response.preferred_branch! : response.current_branch;
      }
      if (nextBranch !== currentBranch) setCurrentBranch(nextBranch);
    }
    setLastSync({ response, projectId, clearStoredBranch });
  }

  // The remembered branch no longer exists on the server: forget it.
  useEffect(() => {
    if (!lastSync?.clearStoredBranch) return;
    try {
      sessionStorage.removeItem(`ontobuilder:branch:${lastSync.projectId}`);
    } catch {
    }
  }, [lastSync]);

  // Once the branch list is available, honour an explicitly requested initial branch.
  const [initialBranchHandled, setInitialBranchHandled] = useState(false);
  if (
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

  const refreshBranches = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: branchQueryKeys.list(projectId),
    });
  }, [queryClient, projectId]);

  const createBranch = useCallback(
    async (name: string, fromBranch?: string): Promise<BranchInfo> => {
      const newBranch = await branchesApi.create(
        projectId,
        { name, from_branch: fromBranch }
      );

      await refreshBranches();

      setCurrentBranch(name);
      setStoredBranch(projectId, name);
      branchesApi.savePreference(projectId, name).catch(() => {});

      return newBranch;
    },
    [projectId, refreshBranches]
  );

  const switchBranch = useCallback(
    async (name: string) => {
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

      branchesApi.savePreference(projectId, name).catch(() => {});
    },
    [branches, pendingChanges, projectId]
  );

  const deleteBranch = useCallback(
    async (name: string, force = false) => {
      if (name === currentBranch) {
        throw new Error("Cannot delete the current branch");
      }

      if (name === defaultBranch) {
        throw new Error("Cannot delete the default branch");
      }

      await branchesApi.delete(projectId, name, force);

      await refreshBranches();
    },
    [projectId, currentBranch, defaultBranch, refreshBranches]
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
