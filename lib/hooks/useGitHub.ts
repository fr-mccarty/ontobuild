import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubApi, type CreateGitHubRepoRequest, type GitHubRemote } from "@/lib/api/github";
import { branchQueryKeys } from "@/lib/context/BranchContext";

export const githubQueryKeys = {
  remote: (projectId: string) => ["github", projectId] as const,
};

/** The project's GitHub link and the actions on it (link, unlink, fetch, pull, push, create). */
export function useGitHub(projectId: string) {
  const queryClient = useQueryClient();
  const key = githubQueryKeys.remote(projectId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => githubApi.get(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const setRemote = (data: GitHubRemote) => {
    const { remote_url, web_url, host, is_github, branch, upstream, ahead, behind, last_fetched_at, gh_available, gh_authenticated } = data;
    queryClient.setQueryData<GitHubRemote>(key, {
      remote_url, web_url, host, is_github, branch, upstream, ahead, behind, last_fetched_at, gh_available, gh_authenticated,
    });
  };

  const link = useMutation({ mutationFn: (url: string) => githubApi.link(projectId, url), onSuccess: setRemote });
  const unlink = useMutation({
    mutationFn: () => githubApi.unlink(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const fetchRemote = useMutation({ mutationFn: () => githubApi.fetch(projectId), onSuccess: setRemote });
  const push = useMutation({
    mutationFn: (opts: { all?: boolean } = {}) => githubApi.push(projectId, opts),
    onSuccess: setRemote,
  });
  const pull = useMutation({
    mutationFn: () => githubApi.pull(projectId),
    onSuccess: (data) => {
      setRemote(data);
      // The checked-out branch moved: refresh everything that reads the ontology.
      queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey.includes(projectId) && q.queryKey[0] !== "github",
      });
    },
  });
  const create = useMutation({
    mutationFn: (req: CreateGitHubRepoRequest) => githubApi.create(projectId, req),
    onSuccess: setRemote,
  });

  return { query, link, unlink, fetchRemote, push, pull, create };
}
