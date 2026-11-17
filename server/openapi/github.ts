import { error, ref, type DocMap, type Schema } from "./types";

export const githubSchemas: Record<string, Schema> = {
  GitHubRemote: {
    type: "object",
    description: "The project repository's `origin` remote and how the checked-out branch compares with it.",
    required: [
      "remote_url",
      "web_url",
      "host",
      "is_github",
      "branch",
      "upstream",
      "ahead",
      "behind",
      "last_fetched_at",
      "gh_available",
      "gh_authenticated",
    ],
    properties: {
      remote_url: { type: ["string", "null"], description: "URL of `origin`, or null when the project is not linked.", examples: ["git@github.com:acme/pizza.git"] },
      web_url: { type: ["string", "null"], description: "The repository's web page, derived from the remote URL.", examples: ["https://github.com/acme/pizza"] },
      host: { type: ["string", "null"], description: "Host name of the remote.", examples: ["github.com"] },
      is_github: { type: "boolean", description: "True when the remote is on github.com." },
      branch: { type: "string", description: "The branch checked out in the project folder." },
      upstream: { type: ["string", "null"], description: "The remote-tracking branch the checked-out branch follows.", examples: ["origin/main"] },
      ahead: { type: ["integer", "null"], description: "Local commits not on the remote branch (as of the last fetch)." },
      behind: { type: ["integer", "null"], description: "Remote commits not on the local branch (as of the last fetch)." },
      last_fetched_at: { type: ["string", "null"], format: "date-time" },
      gh_available: { type: "boolean", description: "Whether the GitHub CLI (`gh`) is installed." },
      gh_authenticated: { type: "boolean", description: "Whether `gh` is signed in to github.com." },
    },
  },
  GitHubRemoteResult: {
    allOf: [
      ref("GitHubRemote"),
      {
        type: "object",
        required: ["output"],
        properties: { output: { type: "string", description: "What git (or gh) printed." } },
      },
    ],
  },
};

const authError = error(
  "Git could not sign in to the remote. Run `gh auth login`, set up a credential helper, or load your SSH key.",
);

export const githubDocs: DocMap = {
  "GET /projects/{id}/github": {
    summary: "Get the GitHub link",
    description:
      "The project's `origin` remote, the checked-out branch and how far it is ahead of or behind the remote branch as of the last fetch, and whether the GitHub CLI is installed and signed in.",
    responses: { "200": { description: "The remote", schema: ref("GitHubRemote") }, "404": error("Project not found") },
  },
  "PUT /projects/{id}/github": {
    summary: "Link to a remote",
    description:
      "Sets (or changes) the `origin` remote. Accepts `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo(.git)` and other HTTPS or SSH git hosts. URLs with embedded credentials are rejected: authentication uses your git credential helper, SSH agent or `gh auth login`.",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["remote_url"],
        properties: { remote_url: { type: "string", examples: ["https://github.com/acme/pizza.git"] } },
      },
    },
    responses: {
      "200": { description: "The remote", schema: ref("GitHubRemote") },
      "400": error("Invalid remote URL"),
      "404": error("Project not found"),
    },
  },
  "DELETE /projects/{id}/github": {
    summary: "Unlink the remote",
    description: "Removes the `origin` remote and its remote-tracking branches. Nothing on the remote is deleted.",
    responses: { "204": { description: "Unlinked" }, "404": error("Project or remote not found") },
  },
  "POST /projects/{id}/github/fetch": {
    summary: "Fetch from the remote",
    description: "Runs `git fetch --prune origin`, updating the ahead and behind counts. Times out after 60 seconds.",
    responses: {
      "200": { description: "Fetched", schema: ref("GitHubRemoteResult") },
      "403": authError,
      "409": error("The project is not linked to a remote"),
      "504": error("Git timed out"),
    },
  },
  "POST /projects/{id}/github/push": {
    summary: "Push to the remote",
    description:
      "Pushes the checked-out branch to `origin` and sets it as the branch's upstream. With `all: true`, pushes every local branch.",
    body: {
      schema: { type: "object", properties: { all: { type: "boolean", default: false, description: "Push all local branches." } } },
    },
    responses: {
      "200": { description: "Pushed", schema: ref("GitHubRemoteResult") },
      "403": authError,
      "409": error("Not linked, or the remote has commits that must be pulled first"),
      "504": error("Git timed out"),
    },
  },
  "POST /projects/{id}/github/pull": {
    summary: "Pull from the remote",
    description:
      "Fetches, then fast-forwards the checked-out branch and the project folder to its upstream (`git merge --ff-only`). Refuses with 409 when the branches have diverged or uncommitted changes in the folder would be overwritten.",
    responses: {
      "200": { description: "Pulled", schema: ref("GitHubRemoteResult") },
      "403": authError,
      "409": error("Not linked, cannot fast-forward, or local changes would be overwritten"),
      "504": error("Git timed out"),
    },
  },
  "POST /projects/{id}/github/create": {
    summary: "Create a GitHub repository",
    description:
      "Creates a repository with the GitHub CLI (`gh repo create --source <folder> --remote origin --push`), links it as `origin` and pushes. Needs `gh` installed and signed in (`gh auth login`).",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Repository name, optionally `owner/name`.", examples: ["pizza-ontology"] },
          private: { type: "boolean", default: true },
          description: { type: "string" },
        },
      },
    },
    responses: {
      "200": { description: "Created and pushed", schema: ref("GitHubRemoteResult") },
      "400": error("Invalid name, or gh is not installed or not signed in"),
      "403": authError,
      "409": error("The project is already linked to a remote"),
    },
  },
};
