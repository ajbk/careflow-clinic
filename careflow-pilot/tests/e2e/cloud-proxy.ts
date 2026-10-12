import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

/** Ephemeral loopback TLS fixture. Keys exist only in this test's private temporary directory. */
export async function createCloudTestProxy(directory: string) {
  const key = join(directory, "test-tls.key"); const cert = join(directory, "test-tls.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", key, "-out", cert], { stdio: "ignore" });
  let upstream = ""; let origin = "";
  const proxy = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    const headers = { ...request.headers };
    delete headers.forwarded;
    for (const name of Object.keys(headers)) if (name.startsWith("x-forwarded-")) delete headers[name];
    headers.host = new URL(origin).host; headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-for"] = request.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "127.0.0.1";
    const forwarded = httpRequest(`${upstream}${request.url}`, { method: request.method, headers }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response);
    });
    forwarded.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  origin = `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  return { origin, setUpstream(value: string) { upstream = value; }, async close() { proxy.closeAllConnections(); await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())); } };
}
