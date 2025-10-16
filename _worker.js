// _worker.js — Debug sink for ZVA → Monday writer
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const reqId = crypto.randomUUID();
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("user-agent") || "";
    const method = request.method;
    const contentType = request.headers.get("content-type") || "";

    // Collect headers with auth redacted
    const headersObj = {};
    for (const [k, v] of request.headers.entries()) {
      const lower = k.toLowerCase();
      headersObj[k] = lower.includes("authorization") ? "[REDACTED]" : v;
    }

    // Read body in a content-type aware way
    let bodyText = "";
    if (method !== "GET" && method !== "HEAD") {
      if (contentType.includes("application/json")) {
        bodyText = await request.text();
      } else if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const entries = [];
        for (const [key, val] of form.entries()) {
          if (typeof val === "string") {
            entries.push({ key, value: val });
          } else {
            entries.push({
              key,
              file: {
                name: val.name,
                size: val.size,
                type: val.type,
              },
            });
          }
        }
        bodyText = JSON.stringify({ multipart: entries }, null, 2);
      } else {
        // text/plain, application/x-www-form-urlencoded, or anything else
        bodyText = await request.text();
      }
    }

    // Log summary then chunked headers/body to avoid truncation
    console.log(`[${reqId}] request`, {
      method,
      url: request.url,
      ip,
      ua,
      contentType,
      bodyLen: bodyText.length,
    });

    function logChunk(label, text) {
      const CHUNK = 9000; // be conservative; CF has per-line limits
      if (!text) return;
      for (let i = 0; i < text.length; i += CHUNK) {
        console.log(
          `[${reqId}] ${label} part ${Math.floor(i / CHUNK) + 1}:\n` +
            text.slice(i, i + CHUNK)
        );
      }
    }

    logChunk("headers", JSON.stringify(headersObj, null, 2));
    logChunk("body", bodyText);

    // Build echo payload
    const echo = {
      ok: true,
      reqId,
      method,
      url: request.url,
      ip,
      ua,
      contentType,
      headers: headersObj,
      body: bodyText,
      meta: {
        note: "This is a debug echo. Nothing was forwarded upstream.",
        ts: new Date().toISOString(),
        origin: request.headers.get("x-origin") || null,
        forward_intent: request.headers.get("x-forward-intent") || null,
        debug_original_url: request.headers.get("x-debug-original-url") || null,
      },
    };

    // HTML pretty view if ?html=1 or client prefers HTML
    const wantsHtml = url.searchParams.get("html") === "1" ||
      (request.headers.get("accept") || "").includes("text/html");
    if (wantsHtml) {
      const esc = (s) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Debug Echo</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 24px; }
    .card { border: 1px solid #eee; border-radius: 12px; padding: 16px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
    h1 { font-size: 18px; margin: 0 0 12px; }
    pre { white-space: pre-wrap; word-break: break-word; }
    .meta { color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Debug Echo</h1>
    <div class="meta">reqId: ${esc(reqId)}</div>
    <pre>${esc(JSON.stringify(echo, null, 2))}</pre>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Default JSON echo
    return new Response(JSON.stringify(echo, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};
