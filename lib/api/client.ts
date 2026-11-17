import { errorBody } from "./errors";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function buildUrl(endpoint: string): URL {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return new URL(`${API_BASE}${endpoint}`, origin);
}

export class ApiError extends Error {
  /** `message` is the raw response body: for this API, JSON like `{"detail": "..."}`. */
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The response body parsed as a JSON object, or null when it isn't one. */
  get body(): Record<string, unknown> | null {
    return errorBody(this.message);
  }

  /** The human-readable text: the body's `detail` when it is a string, else the body, else the status. */
  get detail(): string {
    const detail = this.body?.detail;
    if (typeof detail === "string") return detail;
    return this.message || `${this.status} ${this.statusText}`.trim();
  }

  /** The body's `code`, for errors a client can act on (e.g. "turtle_out_of_date"). */
  get code(): string | null {
    const code = this.body?.code;
    return typeof code === "string" ? code : null;
  }
}

export { apiErrorMessage } from "./errors";

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  const url = buildUrl(endpoint);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers = new Headers(fetchOptions.headers);
  if (!headers.has("Content-Type") && fetchOptions.body) {
    headers.set("Content-Type", "application/json");
  }

  for (let attempt = 0; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new ApiError(response.status, response.statusText, message);
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }

      return JSON.parse(text);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error("Unexpected: retry loop exited without returning or throwing");
}

async function uploadFile<T>(
  endpoint: string,
  formData: FormData,
  options: Omit<RequestOptions, "body"> = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  const url = buildUrl(endpoint);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const headers = new Headers(fetchOptions.headers);
  headers.delete("Content-Type");

  const response = await fetch(url.toString(), {
    ...fetchOptions,
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(response.status, response.statusText, message);
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text);
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  phase: "uploading" | "processing";
}

interface UploadWithProgressOptions {
  headers?: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
}

function uploadFileWithProgress<T>(
  endpoint: string,
  formData: FormData,
  options: UploadWithProgressOptions = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = buildUrl(endpoint).toString();

    xhr.timeout = 300000;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: Math.round((event.loaded / event.total) * 100),
          phase: "uploading",
        });
      }
    });

    xhr.upload.addEventListener("load", () => {
      if (options.onProgress) {
        options.onProgress({
          loaded: 100,
          total: 100,
          percentage: 100,
          phase: "processing",
        });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
          resolve(response as T);
        } catch {
          resolve(undefined as T);
        }
      } else {
        reject(new ApiError(xhr.status, xhr.statusText, xhr.responseText));
      }
    });

    xhr.addEventListener("error", async () => {
      let serverReachable = false;
      try {
        await fetch(buildUrl("/api/v1/health").toString(), { method: "GET" });
        serverReachable = true;
      } catch {
      }

      reject(
        new ApiError(
          0,
          "Network Error",
          serverReachable
            ? "The server encountered an error processing your upload. Please try again or check the server logs."
            : "Could not reach the server. Please check that the API server is running and accessible."
        )
      );
    });

    xhr.addEventListener("timeout", () => {
      reject(
        new ApiError(
          0,
          "Timeout",
          "The upload timed out. The file may be too large for the server to process, or the server is not responding."
        )
      );
    });

    xhr.addEventListener("abort", () => {
      reject(new ApiError(0, "Aborted", "Upload was cancelled"));
    });

    xhr.open("POST", url);

    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== "content-type") {
          xhr.setRequestHeader(key, value);
        }
      });
    }

    xhr.send(formData);
  });
}

export const api = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(endpoint: string, data?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),

  upload: <T>(endpoint: string, formData: FormData, options?: Omit<RequestOptions, "body">) =>
    uploadFile<T>(endpoint, formData, options),

  uploadWithProgress: <T>(
    endpoint: string,
    formData: FormData,
    options?: UploadWithProgressOptions
  ) => uploadFileWithProgress<T>(endpoint, formData, options),
};

export interface LocalizedString {
  value: string;
}

export interface OWLClassTreeNode {
  iri: string;
  label: string;
  child_count: number;
  deprecated: boolean;
}

export interface OWLClassTreeResponse {
  nodes: OWLClassTreeNode[];
  total_classes: number;
}

export interface AnnotationValue extends LocalizedString {
  /** Whether the value is a literal or an IRI reference. */
  type: "iri" | "literal";
}

export interface AnnotationProperty {
  property_iri: string;
  property_label: string;
  values: AnnotationValue[];
}

export interface OWLClassDetail {
  iri: string;
  labels: LocalizedString[];
  comments: LocalizedString[];
  deprecated: boolean;
  parent_iris: string[];
  parent_labels: Record<string, string>;
  equivalent_iris: string[] | null;
  disjoint_iris: string[] | null;
  child_count: number;
  instance_count: number | null;
  instances?: { iri: string; label: string }[];
  annotations: AnnotationProperty[];
}

export const projectOntologyApi = {
  getRootClasses: (projectId: string, branch?: string) =>
    api.get<OWLClassTreeResponse>(`/api/v1/projects/${projectId}/ontology/tree`, {
      params: { branch },
    }),

  getClassChildren: (projectId: string, classIri: string, branch?: string) =>
    api.get<OWLClassTreeResponse>(
      `/api/v1/projects/${projectId}/ontology/tree/${encodeURIComponent(classIri)}/children`,
      {
        params: { branch },
      }
    ),

  getClassAncestors: (projectId: string, classIri: string, branch?: string) =>
    api.get<OWLClassTreeResponse>(
      `/api/v1/projects/${projectId}/ontology/tree/${encodeURIComponent(classIri)}/ancestors`,
      {
        params: { branch },
      }
    ),

  getClassDetail: (projectId: string, classIri: string, branch?: string) =>
    api.get<OWLClassDetail>(
      `/api/v1/projects/${projectId}/ontology/classes/${encodeURIComponent(classIri)}`,
      {
        params: { branch },
      }
    ),

  searchEntities: (
    projectId: string,
    query: string,
    branch?: string,
    entityTypes?: string,
    limit?: number,
  ) =>
    api.get<EntitySearchResponse>(
      `/api/v1/projects/${projectId}/ontology/search`,
      {
        params: { q: query, branch, entity_types: entityTypes, limit },
      }
    ),

  updateClass: (
    projectId: string,
    classIri: string,
    data: ClassUpdatePayload,
    commitMessage: string,
    branch?: string
  ) =>
    api.patch<OWLClassDetail>(
      `/api/v1/projects/${projectId}/ontology/classes/${encodeURIComponent(classIri)}`,
      { ...data, commit_message: commitMessage },
      {
        params: { branch },
      }
    ),

  deleteClass: (
    projectId: string,
    classIri: string,
    commitMessage: string,
    branch?: string
  ) =>
    api.delete(`/api/v1/projects/${projectId}/ontology/classes/${encodeURIComponent(classIri)}`, {
      params: { commit_message: commitMessage, branch },
    }),

  reindex: (projectId: string, branch?: string) =>
    api.post<ReindexResponse>(
      `/api/v1/projects/${projectId}/ontology/reindex`,
      undefined,
      {
        params: { branch },
      }
    ),

  getIndexStatus: (projectId: string, branch?: string) =>
    api.get<IndexStatusResponse>(
      `/api/v1/projects/${projectId}/ontology/index-status`,
      {
        params: { branch },
      }
    ),

  saveSource: (
    projectId: string,
    content: string,
    commitMessage: string,
    branch?: string
  ) =>
    api.put<SourceContentSaveResponse>(
      `/api/v1/projects/${projectId}/source`,
      { content, commit_message: commitMessage },
      {
        params: { branch },
      }
    ),
};

export { qualityApi } from "./quality";
export { analyticsApi } from "./analytics";

export interface AnnotationUpdate {
  property_iri: string;
  values: LocalizedString[];
}

export interface ClassUpdatePayload {
  labels: LocalizedString[];
  comments: LocalizedString[];
  parent_iris: string[];
  annotations?: AnnotationUpdate[];
  deprecated?: boolean;
  equivalent_iris?: string[];
  disjoint_iris?: string[];
}

export interface EntitySearchResult {
  iri: string;
  label: string;
  entity_type: "class" | "property" | "individual";
  property_kind?: "object" | "data" | "annotation" | null;
  deprecated: boolean;
}

export interface EntitySearchResponse {
  results: EntitySearchResult[];
  total: number;
}

export interface ReindexResponse {
  status: "accepted";
  branch: string;
}

export type IndexStatus = "pending" | "indexing" | "ready" | "failed";

export interface IndexStatusResponse {
  project_id: string;
  branch: string;
  status: IndexStatus;
  entity_count: number | null;
  commit_hash: string | null;
  error_message: string | null;
  indexed_at: string | null;
}

export interface SourceContentSaveResponse {
  success: boolean;
  commit_hash: string;
  commit_message: string;
  branch: string;
}
