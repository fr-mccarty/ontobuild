import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import {
  workspaceApi,
  type CreateTerminalRequest,
  type DevServerConfig,
  type DevServerStatus,
  type TerminalSession,
} from "@/lib/api/workspace";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";

export const workspaceQueryKeys = {
  files: (projectId: string) => ["workspace", "files", projectId] as const,
  fileContent: (projectId: string, path: string) => ["workspace", "file", projectId, path] as const,
  terminals: (projectId: string) => ["workspace", "terminals", projectId] as const,
  devServer: (projectId: string) => ["workspace", "dev-server", projectId] as const,
};

export function useWorkspaceFiles(projectId: string, enabled = true) {
  return useQuery({
    queryKey: workspaceQueryKeys.files(projectId),
    queryFn: () => workspaceApi.listFiles(projectId),
    enabled: !!projectId && enabled,
  });
}

/** Text content of a file; 413/415 errors are not retried (the caller shows "too large"/"binary"). */
export function useWorkspaceFileContent(projectId: string, path: string | null, enabled = true) {
  return useQuery({
    queryKey: workspaceQueryKeys.fileContent(projectId, path ?? ""),
    queryFn: () => workspaceApi.readFile(projectId, path as string),
    enabled: !!projectId && !!path && enabled,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    staleTime: 5_000,
  });
}

export function useDeleteWorkspaceFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => workspaceApi.deleteFile(projectId, path),
    onSettled: () => qc.invalidateQueries({ queryKey: workspaceQueryKeys.files(projectId) }),
  });
}

export function useTerminalSessions(projectId: string) {
  return useQuery({
    queryKey: workspaceQueryKeys.terminals(projectId),
    queryFn: () => workspaceApi.listTerminals(projectId),
    enabled: !!projectId,
  });
}

/** Creates a terminal session and opens it as the active tab in the bottom panel. */
export function useCreateTerminal(projectId: string) {
  const qc = useQueryClient();
  const addTerminal = useWorkspaceStore((s) => s.addTerminal);
  return useMutation({
    mutationFn: (body: CreateTerminalRequest) => workspaceApi.createTerminal(projectId, body),
    onSuccess: (session: TerminalSession) => {
      addTerminal({ id: session.id, title: session.title, kind: session.kind });
      qc.invalidateQueries({ queryKey: workspaceQueryKeys.terminals(projectId) });
    },
  });
}

/** Dev server status; polled every 3s while it is running so a detected URL shows up. */
export function useDevServer(projectId: string) {
  return useQuery({
    queryKey: workspaceQueryKeys.devServer(projectId),
    queryFn: () => workspaceApi.getDevServer(projectId),
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
}

export function useDevServerActions(projectId: string) {
  const qc = useQueryClient();
  const addTerminal = useWorkspaceStore((s) => s.addTerminal);
  const onStatus = (status: DevServerStatus) => {
    qc.setQueryData(workspaceQueryKeys.devServer(projectId), status);
    qc.invalidateQueries({ queryKey: workspaceQueryKeys.terminals(projectId) });
  };
  const start = useMutation({
    mutationFn: () => workspaceApi.startDevServer(projectId),
    onSuccess: (status) => {
      onStatus(status);
      if (status.terminal_id) addTerminal({ id: status.terminal_id, title: "Dev server", kind: "devserver" });
    },
  });
  const stop = useMutation({
    mutationFn: () => workspaceApi.stopDevServer(projectId),
    onSuccess: onStatus,
  });
  const configure = useMutation({
    mutationFn: (config: DevServerConfig) => workspaceApi.configureDevServer(projectId, config),
    onSuccess: onStatus,
  });
  return { start, stop, configure };
}
