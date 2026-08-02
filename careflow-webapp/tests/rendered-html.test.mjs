import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/", origin = "http://localhost", extraHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const requestUrl = new URL(pathname, origin);

  return worker.fetch(
    new Request(requestUrl, {
      headers: {
        accept: "text/html",
        host: requestUrl.host,
        "x-forwarded-host": requestUrl.host,
        "x-forwarded-proto": requestUrl.protocol.slice(0, -1),
        ...extraHeaders,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the CareFlow product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CareFlow — ระบบจัดการคลินิกชุมชน<\/title>/i);
  assert.match(html, /ภาพรวมคลินิก/);
  assert.match(html, /ต้นแบบสำหรับการสาธิต/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("uses the incoming request host for absolute social metadata", async () => {
  const response = await render("/", "https://careflow.example.test");
  const html = await response.text();

  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/careflow\.example\.test\/og\.png"\s*\/?>/i,
  );
  assert.match(
    html,
    /<meta name="twitter:image" content="https:\/\/careflow\.example\.test\/og\.png"\s*\/?>/i,
  );
});

test("prefers a strictly parsed configured canonical origin for social metadata", async () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://careflow.canonical.test/path-that-is-not-used";
  try {
    const response = await render("/", "https://careflow.request.test");
    const html = await response.text();
    assert.match(html, /<meta property="og:image" content="https:\/\/careflow\.canonical\.test\/og\.png"\s*\/?>/i);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("falls back safely when a malformed forwarded host cannot form an origin", async () => {
  const response = await render("/", "https://careflow.example.test", {
    "x-forwarded-host": "::::",
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<meta property="og:image" content="https:\/\/careflow\.example\.test\/og\.png"\s*\/?>/i);
});

test("server-renders every CareFlow route", async () => {
  const routes = [
    "/",
    "/intake",
    "/queue",
    "/consultations/demo-visit",
    "/visits/demo-visit/opd-card",
    "/dispensing/demo-visit",
    "/dispensing/demo-visit/labels",
    "/checkout/demo-visit",
    "/patients/patient-somchai/history",
    "/inventory",
    "/inventory/receive",
    "/appointments",
    "/appointments/new",
    "/analytics",
  ];

  for (const route of routes) {
    const response = await render(route);
    assert.equal(response.status, 200, `${route} should render successfully`);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
      `${route} should return HTML`,
    );
  }
});
