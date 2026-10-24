// Client for the Django API under /api/v1. The browser only ever calls its own origin: Vite (dev) and
// Vercel (staging) forward /api to the backend, so the session and CSRF cookies stay first-party.

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function cookie(name: string): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfReady: Promise<void> | null = null;
function ensureCsrf(): Promise<void> {
  if (cookie("csrftoken")) return Promise.resolve();
  csrfReady ??= fetch(`${BASE}/auth/csrf`, { credentials: "same-origin" }).then(() => undefined);
  return csrfReady;
}

// The server's message is written for the user; show it as it is. Field errors become one sentence.
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string") return b.detail;
    const first = Object.entries(b).find(([, v]) => Array.isArray(v) && v.length);
    if (first) return String((first[1] as unknown[])[0]);
  }
  if (status === 403) return "Your session has ended or you do not have access. Sign in again.";
  if (status === 404) return "Not found. It may not exist, or it is not assigned to you.";
  if (status >= 500) return "The server could not complete this. Try again, and tell ICT if it keeps happening.";
  return "The request was not accepted.";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const write = method !== "GET";
  if (write) await ensureCsrf();
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (write) headers["X-CSRFToken"] = cookie("csrftoken") ?? "";

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError("Cannot reach the server. Check the connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status, (data as { code?: string })?.code);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  upload: <T>(path: string, file: File, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(extra)) if (v) form.append(k, v);
    return request<T>("POST", path, form);
  },
  url: (path: string) => `${BASE}${path}`,
  /** Fetch a file (an export) and hand it to the browser to save. Errors arrive as ApiError.
   * With a body it is a POST, for exports that need a reason. */
  download: async (path: string, filename: string, body?: unknown) => {
    let res: Response;
    const init: RequestInit = { credentials: "same-origin" };
    if (body !== undefined) {
      await ensureCsrf();
      init.method = "POST";
      init.headers = { "Content-Type": "application/json", "X-CSRFToken": cookie("csrftoken") ?? "" };
      init.body = JSON.stringify(body);
    }
    try {
      res = await fetch(`${BASE}${path}`, init);
    } catch {
      throw new ApiError("Cannot reach the server. Check the connection and try again.", 0);
    }
    if (!res.ok) {
      const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
      throw new ApiError(messageFrom(data, res.status), res.status);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

type Page<T> = { count: number; results: T[] };

// Reads every page by number. The server's own "next" links carry its internal host, so they are not used.
export async function getAll<T>(path: string, pageSize = 50): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const first = await api.get<Page<T>>(`${path}${sep}page=1`);
  const pages = Math.ceil(first.count / pageSize);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => api.get<Page<T>>(`${path}${sep}page=${i + 2}`)),
  );
  return [first, ...rest].flatMap((p) => p.results);
}
