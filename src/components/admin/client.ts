// Browser-side client for /api/admin. It carries no credentials of its own: the Cloudflare Access cookie
// is sent automatically, and every decision (who may do what) is made by the server.

export class AdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function adminRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-requested-with"] = "tryaitools-admin"; // required by the server's CSRF check
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetchFn(`/api/admin/${path.replace(/^\/+/, "")}`, init);
  } catch {
    throw new AdminApiError(0, "network_error", "Could not reach the server. Nothing was saved.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON (e.g. an Access login page): handled below
  }
  if (!res.ok || !data) {
    const e = (
      data as {
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      } | null
    )?.error;
    throw new AdminApiError(
      res.status || 0,
      e?.code ?? "http_error",
      e?.message ??
        (res.status === 401 || res.status === 403
          ? "You are not signed in as an authorized admin."
          : "The server returned an unexpected response. Nothing was saved."),
      e?.fields ?? {},
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => adminRequest<T>("GET", path),
  post: <T>(path: string, body: unknown) => adminRequest<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => adminRequest<T>("PUT", path, body),
  del: <T>(path: string, body: unknown) => adminRequest<T>("DELETE", path, body),
};

export const qs = (params: Record<string, string | number | undefined | null | false>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};
