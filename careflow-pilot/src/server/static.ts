import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface ClientAssetsOptions {
  root: string;
}

function assertClientAssets(root: string): string {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot) || !lstatSync(absoluteRoot).isDirectory()) {
    throw new Error("CareFlow client assets directory is missing");
  }
  const indexPath = resolve(absoluteRoot, "index.html");
  if (!existsSync(indexPath) || !lstatSync(indexPath).isFile()) {
    throw new Error("CareFlow client entrypoint is missing");
  }
  return absoluteRoot;
}

function isApiPath(request: FastifyRequest): boolean {
  const pathname = request.url.split("?", 1)[0] ?? request.url;
  return pathname === "/api" || pathname.startsWith("/api/");
}

function sendIndex(root: string, reply: FastifyReply): FastifyReply {
  const indexPath = resolve(root, "index.html");
  // assertClientAssets prevents this from being absent at startup. Reading on
  // demand keeps the handler correct when a deploy swaps the dist directory.
  return reply.type("text/html; charset=utf-8").send(readFileSync(indexPath));
}

/**
 * Register production-only client serving. Fastify-static handles known
 * assets, while the not-found handler in app.ts delegates non-API routes to
 * the SPA entrypoint for browser deep links.
 */
export async function registerClientAssets(
  app: FastifyInstance,
  options: ClientAssetsOptions,
): Promise<{ root: string; sendIndex: (reply: FastifyReply) => FastifyReply }> {
  const root = assertClientAssets(options.root);
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: false,
    index: false,
    decorateReply: false,
  });
  return { root, sendIndex: (reply) => sendIndex(root, reply) };
}

export { isApiPath };
