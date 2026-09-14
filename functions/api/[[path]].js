/**
 * Cloudflare Pages Function: API Reverse Proxy
 * Proxies incoming /api/* requests to the VPS agentcy-bridge service.
 * Eliminates browser Mixed Content issues by providing HTTPS edge termination.
 */

export async function onRequest(context) {
  const { request, params, env } = context;
  
  // Default VPS bridge endpoint (or override with CF env var VPS_BACKEND_URL)
  const backendBase = env.VPS_BACKEND_URL || "http://168.138.75.255/api/agentcy";
  
  // Extract path parameters: e.g. ["auth", "login"] -> "auth/login"
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const targetUrl = new URL(`${backendBase}/api/${path}`);
  
  // Forward original query parameters
  const requestUrl = new URL(request.url);
  targetUrl.search = requestUrl.search;

  // Clone headers and set forwarded attributes
  const headers = new Headers(request.headers);
  headers.set("Host", "168.138.75.255");
  headers.set("X-Forwarded-Host", requestUrl.host);
  headers.set("X-Forwarded-Proto", "https");

  const forwardOptions = {
    method: request.method,
    headers: headers,
    redirect: "follow",
  };

  // Only attach body for methods that allow it
  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    forwardOptions.body = request.body;
  }

  try {
    const backendResponse = await fetch(targetUrl.toString(), forwardOptions);

    // Copy response headers and ensure CORS is friendly
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
