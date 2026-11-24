import { error, ref, type DocMap, type Schema } from "./types";

const nullableDateTime: Schema = { type: ["string", "null"], format: "date-time" };
const nullableUser: Schema = { oneOf: [ref("PullRequestUser"), { type: "null" }] };

export const pullRequestSchemas: Record<string, Schema> = {
  PullRequestUser: {
    type: "object",
    required: ["id", "name", "email"],
    properties: {
      id: { type: "string", examples: ["local-user"] },
      name: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
    },
  },
  PullRequest: {
    type: "object",
    required: [
      "id", "project_id", "pr_number", "title", "description", "source_branch", "target_branch", "status",
      "author_id", "author", "merged_by", "merged_by_user", "merged_at", "merge_commit_hash", "base_commit_hash",
      "head_commit_hash", "created_at", "updated_at", "review_count", "approval_count", "comment_count",
      "commits_ahead", "can_merge", "merge_blocked_reason", "rule_violations_added",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      pr_number: { type: "integer", minimum: 1, description: "Sequential number within the project." },
      title: { type: "string" },
      description: { type: ["string", "null"] },
      source_branch: { type: "string" },
      target_branch: { type: "string" },
      status: { type: "string", enum: ["open", "closed", "merged"] },
      author_id: { type: "string" },
      author: nullableUser,
      merged_by: { type: ["string", "null"], description: "User id of whoever merged the pull request." },
      merged_by_user: nullableUser,
      merged_at: nullableDateTime,
      merge_commit_hash: { type: ["string", "null"] },
      base_commit_hash: {
        type: ["string", "null"],
        description: "Target branch head at merge time. Set only once merged.",
      },
      head_commit_hash: {
        type: ["string", "null"],
        description: "Source branch head at merge time. Set only once merged.",
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: nullableDateTime,
      review_count: { type: "integer" },
      approval_count: { type: "integer" },
      comment_count: { type: "integer", description: "All comments, including replies." },
      commits_ahead: { type: "integer", description: "Commits on the source branch that are not on the target branch." },
      can_merge: {
        type: "boolean",
        description:
          "True when the pull request is open, has commits to merge (`commits_ahead` > 0), has at least the project's required number of approvals and adds no rule violations (`rule_violations_added` is empty).",
      },
      merge_blocked_reason: {
        type: ["string", "null"],
        description: "Why `can_merge` is false, or null when it is true.",
      },
      rule_violations_added: {
        type: "array",
        items: ref("RuleViolation"),
        description:
          "Rule violations the source branch has that the target branch does not, compared by rule, focus node, property and value. Empty unless the pull request is open.",
      },
    },
  },
  PullRequestReview: {
    type: "object",
    required: ["id", "pull_request_id", "reviewer_id", "reviewer", "status", "body", "created_at"],
    properties: {
      id: { type: "string" },
      pull_request_id: { type: "string" },
      reviewer_id: { type: "string" },
      reviewer: nullableUser,
      status: { type: "string", enum: ["approved", "changes_requested", "commented"] },
      body: { type: ["string", "null"] },
      created_at: { type: "string", format: "date-time" },
    },
  },
  PullRequestComment: {
    type: "object",
    required: ["id", "pull_request_id", "author_id", "author", "body", "parent_id", "created_at", "updated_at", "replies"],
    properties: {
      id: { type: "string" },
      pull_request_id: { type: "string" },
      author_id: { type: "string" },
      author: nullableUser,
      body: { type: "string" },
      parent_id: { type: ["string", "null"], description: "Id of the comment this replies to." },
      created_at: { type: "string", format: "date-time" },
      updated_at: nullableDateTime,
      replies: { type: "array", items: ref("PullRequestComment"), description: "Nested replies, oldest first." },
    },
  },
  PullRequestCommit: {
    type: "object",
    required: ["hash", "short_hash", "message", "author_name", "author_email", "timestamp"],
    properties: {
      hash: { type: "string" },
      short_hash: { type: "string", description: "First 8 characters of the hash." },
      message: { type: "string" },
      author_name: { type: "string" },
      author_email: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
    },
  },
  PullRequestFileChange: {
    type: "object",
    required: ["path", "change_type", "old_path", "additions", "deletions", "patch"],
    properties: {
      path: { type: "string" },
      change_type: { type: "string", enum: ["added", "modified", "deleted", "renamed"] },
      old_path: { type: ["string", "null"], description: "Previous path for renamed files." },
      additions: { type: "integer" },
      deletions: { type: "integer" },
      patch: { type: ["string", "null"], description: "Unified diff for this file." },
    },
  },
  PullRequestDiff: {
    type: "object",
    required: ["files", "total_additions", "total_deletions", "files_changed"],
    properties: {
      files: { type: "array", items: ref("PullRequestFileChange") },
      total_additions: { type: "integer" },
      total_deletions: { type: "integer" },
      files_changed: { type: "integer" },
    },
  },
  PullRequestSettings: {
    type: "object",
    required: ["pr_approval_required"],
    properties: {
      pr_approval_required: {
        type: "integer",
        minimum: 0,
        description: "Approving reviews needed before a pull request can be merged. 0 disables the check.",
      },
    },
  },
};

const listOf = (item: string, extra: Record<string, Schema> = {}): Schema => ({
  type: "object",
  required: ["items", "total", ...Object.keys(extra)],
  properties: { items: { type: "array", items: ref(item) }, total: { type: "integer" }, ...extra },
});

const notFound = error("The project or pull request does not exist.");
const badPrNumber = error("The PR number is not an integer.");
const commentBody: Schema = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string", minLength: 1 } },
};

export const pullRequestDocs: DocMap = {
  "GET /projects/pull-requests/open-summary": {
    summary: "Count open pull requests",
    description: "Counts open pull requests across all projects. Projects with none are omitted.",
    responses: {
      "200": {
        description: "Open pull request counts, ordered by project name.",
        schema: {
          type: "object",
          required: ["total_open", "by_project"],
          properties: {
            total_open: { type: "integer" },
            by_project: {
              type: "array",
              items: {
                type: "object",
                required: ["project_id", "project_name", "open_count"],
                properties: {
                  project_id: { type: "string" },
                  project_name: { type: "string" },
                  open_count: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  },
  "GET /projects/{id}/pull-requests": {
    summary: "List pull requests",
    description: "Newest first.",
    query: [
      { name: "status", description: "Only pull requests with this status.", schema: { type: "string", enum: ["open", "closed", "merged"] } },
      { name: "author_id", description: "Only pull requests opened by this user id.", schema: { type: "string" } },
      { name: "skip", description: "Number of items to skip.", schema: { type: "integer", minimum: 0, default: 0 } },
      { name: "limit", description: "Page size.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    ],
    responses: {
      "200": {
        description: "A page of pull requests.",
        schema: listOf("PullRequest", { skip: { type: "integer" }, limit: { type: "integer" } }),
      },
      "404": error("The project does not exist."),
      "422": error("`skip` or `limit` is out of range, or `status` is not open, closed or merged."),
    },
  },
  "POST /projects/{id}/pull-requests": {
    summary: "Open a pull request",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["title", "source_branch"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          description: { type: ["string", "null"], description: "Omit or send null for no description." },
          source_branch: { type: "string", minLength: 1, maxLength: 255 },
          target_branch: { type: "string", minLength: 1, maxLength: 255, default: "main" },
        },
      },
    },
    responses: {
      "201": { description: "The new pull request.", schema: ref("PullRequest") },
      "400": error("A branch does not exist, or the source and target branches are the same."),
      "404": error("The project does not exist."),
      "422": error("A field is missing or invalid."),
    },
  },
  "GET /projects/{id}/pull-requests/{prNumber}": {
    summary: "Get a pull request",
    responses: {
      "200": { description: "The pull request.", schema: ref("PullRequest") },
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "PATCH /projects/{id}/pull-requests/{prNumber}": {
    summary: "Update a pull request",
    description:
      "Changes the title or description of an open pull request. Omitted fields are left unchanged; `description: null` clears the description.",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          description: { type: ["string", "null"], description: "null clears the description." },
        },
      },
    },
    responses: {
      "200": { description: "The updated pull request.", schema: ref("PullRequest") },
      "409": error("The pull request is closed or merged."),
      "404": notFound,
      "422": error("A field is invalid, or the PR number is not an integer."),
    },
  },
  "POST /projects/{id}/pull-requests/{prNumber}/close": {
    summary: "Close a pull request",
    responses: {
      "200": { description: "The closed pull request.", schema: ref("PullRequest") },
      "409": error("The pull request is already closed or merged."),
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "POST /projects/{id}/pull-requests/{prNumber}/reopen": {
    summary: "Reopen a pull request",
    responses: {
      "200": { description: "The reopened pull request.", schema: ref("PullRequest") },
      "409": error("The pull request is not closed."),
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "POST /projects/{id}/pull-requests/{prNumber}/merge": {
    summary: "Merge a pull request",
    description:
      "Merges the source branch into the target branch. The pull request must be open and have the project's required number of approvals. " +
      "If the target branch already contains every commit of the source branch (`commits_ahead` is 0), the merge is refused with 409 " +
      "\"Nothing to merge\" and the pull request stays open; close it instead. " +
      "It is also refused with 409 while the source branch adds rule violations the target branch does not have; the body then has " +
      "`code: \"rule_violations\"` and the `rule_violations_added` list.",
    body: {
      required: false,
      schema: {
        type: "object",
        properties: {
          merge_message: {
            type: "string",
            description: "Commit message. Defaults to `Merge pull request #<n>: <title>`.",
          },
          delete_source_branch: {
            type: "boolean",
            default: false,
            description: "Delete the source branch after a successful merge.",
          },
        },
      },
    },
    responses: {
      "200": {
        description: "The merge succeeded.",
        schema: {
          type: "object",
          required: ["success", "message", "merged_at", "merge_commit_hash"],
          properties: {
            success: { type: "boolean", const: true },
            message: { type: "string" },
            merged_at: { type: "string", format: "date-time" },
            merge_commit_hash: {
              type: ["string", "null"],
              description: "The new merge commit, or the new target head when the merge was a fast-forward.",
            },
          },
        },
      },
      "400": error("The pull request lacks approvals, or a branch no longer exists."),
      "404": error("The project, pull request or repository does not exist."),
      "409": {
        description:
          "The pull request is not open, there is nothing to merge, the source branch adds rule violations, or the merge failed (for example because of conflicts).",
        schema: {
          type: "object",
          required: ["detail"],
          properties: {
            detail: { type: "string" },
            code: { type: "string", const: "rule_violations", description: "Set when rule violations refused the merge." },
            rule_violations_added: { type: "array", items: ref("RuleViolation") },
          },
        },
      },
      "422": error("A field is invalid, or the PR number is not an integer."),
    },
  },
  "GET /projects/{id}/pull-requests/{prNumber}/reviews": {
    summary: "List reviews",
    description: "Oldest first.",
    responses: {
      "200": { description: "All reviews of the pull request.", schema: listOf("PullRequestReview") },
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "POST /projects/{id}/pull-requests/{prNumber}/reviews": {
    summary: "Submit a review",
    description: "Reviews need an open pull request. (Comments, by contrast, stay open on closed and merged pull requests.)",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["approved", "changes_requested", "commented"] },
          body: { type: ["string", "null"] },
        },
      },
    },
    responses: {
      "201": { description: "The new review.", schema: ref("PullRequestReview") },
      "409": error("The pull request is closed or merged."),
      "404": notFound,
      "422": error("`status` is missing or invalid, or the PR number is not an integer."),
    },
  },
  "GET /projects/{id}/pull-requests/{prNumber}/comments": {
    summary: "List comments",
    description: "Returns top-level comments, oldest first, with replies nested under `replies`. " +
      "`total` counts every comment including replies, matching the pull request's `comment_count`.",
    responses: {
      "200": { description: "The comment threads.", schema: listOf("PullRequestComment") },
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "POST /projects/{id}/pull-requests/{prNumber}/comments": {
    summary: "Add a comment",
    description:
      "Set `parent_id` to reply to another comment on the same pull request. Comments are a discussion, so they can be added, " +
      "edited and deleted on open, closed and merged pull requests alike (reviews need an open pull request).",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1 },
          parent_id: { type: ["string", "null"] },
        },
      },
    },
    responses: {
      "201": { description: "The new comment.", schema: ref("PullRequestComment") },
      "404": error("The project, pull request or parent comment does not exist."),
      "422": error("`body` is missing, or the PR number is not an integer."),
    },
  },
  "PATCH /projects/{id}/pull-requests/{prNumber}/comments/{commentId}": {
    summary: "Edit a comment",
    body: { required: true, schema: commentBody },
    responses: {
      "200": { description: "The updated comment, with its replies.", schema: ref("PullRequestComment") },
      "404": error("The project, pull request or comment does not exist."),
      "422": error("`body` is missing, or the PR number is not an integer."),
    },
  },
  "DELETE /projects/{id}/pull-requests/{prNumber}/comments/{commentId}": {
    summary: "Delete a comment",
    description: "Replies to the comment are deleted with it.",
    responses: {
      "204": { description: "The comment was deleted." },
      "404": error("The project, pull request or comment does not exist."),
      "422": badPrNumber,
    },
  },
  "GET /projects/{id}/pull-requests/{prNumber}/commits": {
    summary: "List pull request commits",
    description:
      "Commits on the source branch that are not on the target branch, newest first. For a merged pull request, the range recorded at merge time is used.",
    responses: {
      "200": { description: "The commits.", schema: listOf("PullRequestCommit") },
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "GET /projects/{id}/pull-requests/{prNumber}/diff": {
    summary: "Get pull request diff",
    description:
      "File-level diff between the target and source branches. For a merged pull request, the range recorded at merge time is used, and an empty diff is returned if it can no longer be computed.",
    responses: {
      "200": { description: "The diff.", schema: ref("PullRequestDiff") },
      "400": error("The diff cannot be computed, for example because a branch no longer exists."),
      "404": notFound,
      "422": badPrNumber,
    },
  },
  "GET /projects/{id}/pr-settings": {
    summary: "Get pull request settings",
    responses: {
      "200": { description: "The project's pull request settings.", schema: ref("PullRequestSettings") },
      "404": error("The project does not exist."),
    },
  },
  "PATCH /projects/{id}/pr-settings": {
    summary: "Update pull request settings",
    body: { required: true, schema: ref("PullRequestSettings") },
    responses: {
      "200": { description: "The saved settings.", schema: ref("PullRequestSettings") },
      "404": error("The project does not exist."),
      "422": error("`pr_approval_required` is not a non-negative integer."),
    },
  },
};
