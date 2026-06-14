import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "camoufox-js", "playwright", "playwright-core"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*"]
  },
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    if (isServer) {
      // Optional native modules. They live in optionalDependencies so
      // `npm install` succeeds on machines without build tools, which means
      // they may be MISSING from node_modules at build time. Treating them
      // as commonjs externals tells webpack to emit a `require()` call and
      // not try to resolve the path itself, so a missing package no longer
      // fails the build. Runtime adapter loaders (createRequire) still
      // surface a clean MODULE_NOT_FOUND if the user really needs it.
      const optionalNativeExternals = [
        "better-sqlite3",
        "camoufox-js",
      ];
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      externals.push(({ request }, callback) => {
        if (optionalNativeExternals.includes(request)) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      });
      config.externals = externals;
    }
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next|gitbook|cli)[\\/]/ };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
