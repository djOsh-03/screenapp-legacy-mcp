export type FetchImplementation = typeof fetch;

function extractSessionCookie(headers: Headers): string | undefined {
  const values = headers.getSetCookie();
  const fallback = headers.get("set-cookie");
  if (values.length === 0 && fallback) values.push(fallback);

  for (const value of values) {
    const match = /(?:^|;\s*)(mcp-session=[^;]+)/i.exec(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function createSessionFetch(
  upstreamOrigin: string,
  baseFetch: FetchImplementation = fetch,
): FetchImplementation {
  let sessionCookie: string | undefined;

  return async (input, init = {}) => {
    const requestUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const headers = new Headers(init.headers);
    if (sessionCookie && requestUrl.origin === upstreamOrigin) {
      headers.set("cookie", sessionCookie);
    }

    const response = await baseFetch(input, {
      ...init,
      headers,
      redirect: "error",
    });
    if (requestUrl.origin === upstreamOrigin) {
      sessionCookie = extractSessionCookie(response.headers) ?? sessionCookie;
    }
    return response;
  };
}
