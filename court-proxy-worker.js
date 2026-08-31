/**
 * Cloudflare Worker — CORS proxy for the Court Availability page.
 *
 * It forwards GET and POST requests (method, headers, and body) to the target
 * site and adds the CORS headers the browser needs. Unlike public proxies
 * (corsproxy.io etc.), this reliably forwards POST bodies, which the BCS
 * venues (Pennant Hills / Beecroft / Cowells Lane) depend on.
 *
 * Usage from the page:  https://<your-worker-url>/?url=<encoded target url>
 *
 * ── Deploy ──────────────────────────────────────────────────────────────
 * 1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 * 2. Name it (e.g. "court-proxy"), Deploy, then "Edit code".
 * 3. Paste this file, then EDIT ALLOWED_ORIGINS BELOW, and Deploy.
 * 4. In index.html set:
 *      const PROXY = "https://court-proxy.<you>.workers.dev/?url=";
 * ────────────────────────────────────────────────────────────────────────
 */

// --- Who may use this worker ---------------------------------------------
// EDIT THIS before making your repo public. Without it, anyone who finds the
// URL can use your Cloudflare account to proxy the sites below.
//
// Read the honest limits in checkOrigin() before relying on this.
const ALLOWED_ORIGINS = [
  // Your published page — replace with your real GitHub Pages origin:
  "https://YOUR-USERNAME.github.io",

  // Local development (start.command serves on 8777):
  "http://localhost:8777",
  "http://127.0.0.1:8777",

  // Opening index.html straight off disk sends "Origin: null".
  // Delete this line if you only ever use the served versions.
  "null",
];

// --- Where it may forward to ---------------------------------------------
// Prevents the worker being used as a general-purpose open proxy.
const ALLOWED_HOSTS = [
  "tennisvenues.com.au",
  "bookable.net.au",
  "tennisbcs.com.au",
];

// --- Burst limits ---------------------------------------------------------
// One "Check Availability" over 14 days × 8 venues is ~112 requests, so these
// have to sit well above normal use. See the note in rateLimited().
const RATE = {
  windowMs: 60_000,
  perIp: 300,
  global: 3000,
};

function hostAllowed(hostname) {
  return ALLOWED_HOSTS.some(d => hostname === d || hostname.endsWith("." + d));
}

/**
 * Origin checking is abuse deterrence, NOT security. A browser can't lie about
 * Origin, so this does stop someone embedding your worker in their own site.
 * A script can simply omit or forge the header, so it does not stop determined
 * abuse — that's what the rate limits and the destination allowlist are for.
 *
 * Requests with no Origin at all are allowed: they can't be cross-site browser
 * requests, and blocking them would only inconvenience curl while a forged
 * header sails through.
 */
function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return { ok: true, origin: null };
  return { ok: ALLOWED_ORIGINS.includes(origin), origin };
}

function corsHeaders(origin) {
  return {
    // Echo the caller's origin rather than "*", so the allowlist actually
    // means something to the browser. Vary matters because the response
    // differs per origin and Cloudflare may cache it.
    "Access-Control-Allow-Origin": origin || "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Sliding-window counters held in the isolate's memory.
 *
 * Deliberately simple, and deliberately limited: Workers run many isolates and
 * recycle them freely, so these counters are per-isolate and reset without
 * warning. Treat this as burst protection that costs nothing, not as a quota.
 *
 * For a real quota, add a Rate Limiting rule in the Cloudflare dashboard
 * (Security → WAF → Rate limiting rules) — suggested: 600 requests per 1
 * minute per IP, matching this worker's route.
 */
const hits = new Map(); // ip -> number[] of timestamps
let globalHits = [];

function prune(list, cutoff) {
  let i = 0;
  while (i < list.length && list[i] < cutoff) i++;
  return i ? list.slice(i) : list;
}

function rateLimited(ip, now) {
  const cutoff = now - RATE.windowMs;

  globalHits = prune(globalHits, cutoff);
  if (globalHits.length >= RATE.global) return "global";

  let mine = prune(hits.get(ip) || [], cutoff);
  if (mine.length >= RATE.perIp) {
    hits.set(ip, mine);
    return "ip";
  }

  mine.push(now);
  hits.set(ip, mine);
  globalHits.push(now);

  // Keep the map from growing without bound as isolates are reused.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || v[v.length - 1] < cutoff) hits.delete(k);
    }
  }

  return null;
}

export default {
  async fetch(request) {
    const { ok: originOk, origin } = checkOrigin(request);
    const CORS = corsHeaders(origin);

    // Preflight. Answer before the origin check so a rejected origin gets a
    // clean CORS error in the console rather than an opaque network failure.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (!originOk) {
      return new Response("Origin not allowed: " + origin, { status: 403, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...CORS, "Allow": "GET, POST, OPTIONS" },
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = rateLimited(ip, Date.now());
    if (limit) {
      return new Response(
        limit === "ip"
          ? "Too many requests from this address. Try again in a minute."
          : "This proxy is busy. Try again in a minute.",
        { status: 429, headers: { ...CORS, "Retry-After": "60" } }
      );
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return new Response("Missing ?url= parameter", { status: 400, headers: CORS });
    }

    let dest;
    try {
      dest = new URL(target);
    } catch {
      return new Response("Invalid target URL", { status: 400, headers: CORS });
    }

    if (dest.protocol !== "https:" && dest.protocol !== "http:") {
      return new Response("Unsupported protocol", { status: 400, headers: CORS });
    }

    if (!hostAllowed(dest.hostname)) {
      return new Response("Host not allowed: " + dest.hostname, { status: 403, headers: CORS });
    }

    // Rebuild the outgoing request: keep method + body, forward content-type,
    // but drop the browser's Origin/Referer so the target treats it as same-origin.
    const init = {
      method: request.method,
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        "Accept": request.headers.get("Accept") || "*/*",
      },
      redirect: "manual",
    };

    const ct = request.headers.get("Content-Type");
    if (ct) init.headers["Content-Type"] = ct;

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    let upstream;
    try {
      let current = dest;
      let method = init.method;
      let body = init.body;

      for (let redirects = 0; redirects <= 5; redirects++) {
        upstream = await fetch(current.toString(), {
          ...init,
          method,
          body: method === "GET" || method === "HEAD" ? undefined : body,
        });

        if (upstream.status < 300 || upstream.status >= 400) break;
        if (redirects === 5) throw new Error("Too many upstream redirects");

        const location = upstream.headers.get("Location");
        if (!location) throw new Error("Upstream redirect had no Location header");

        const next = new URL(location, current);
        if ((next.protocol !== "https:" && next.protocol !== "http:") || !hostAllowed(next.hostname)) {
          throw new Error("Upstream redirect target is not allowed");
        }

        if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }

        current = next;
      }
    } catch (e) {
      return new Response("Upstream fetch failed: " + e.message, { status: 502, headers: CORS });
    }

    // Copy the upstream response and layer CORS on top.
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    // These can confuse the browser when relayed through the worker.
    headers.delete("Content-Security-Policy");
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
