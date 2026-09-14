/**
 * Cloudflare Pages Function: API Reverse Proxy
 * Proxies incoming /api/* requests to the VPS agentcy-bridge service.
 * Eliminates browser Mixed Content issues by providing HTTPS edge termination.
 */

export async function onRequest(context) {
  const { request, params, env } = context;

  // Real HTTPS domain on the VPS via Let's Encrypt
  const backendBase = env.VPS_BACKEND_URL || "https://168.138.75.255.sslip.io/api/agentcy";

  // Extract path parameters: e.g. ["auth", "login"] -> "auth/login"
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const targetUrl = new URL(`${backendBase}/api/${path}`);

  // Forward query parameters
  const requestUrl = new URL(request.url);
  targetUrl.search = requestUrl.search;

  // Clone headers
  const headers = new Headers(request.headers);
  headers.delete("host"); // Let fetch set host header automatically to prevent 1003 error

  const forwardOptions = {
    method: request.method,
    headers: headers,
    redirect: "follow",
  };

  // Only attach body for POST/PUT/PATCH
  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    forwardOptions.body = request.body;
  }

  try {
    const backendResponse = await fetch(targetUrl.toString(), forwardOptions);

    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Backend bridge unreachable",
        detail: error.message,
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
