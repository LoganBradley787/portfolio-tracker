export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(body?.errors?.join('; ') || body?.message || `Request failed (${status})`);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
