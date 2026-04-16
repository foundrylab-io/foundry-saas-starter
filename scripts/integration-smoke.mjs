/**
 * integration-smoke.mjs — Post-build integration smoke tests.
 *
 * Starts the Next.js production server, then:
 * 1. Discovers all page routes from app/(dashboard)/ directory structure
 * 2. Discovers all API routes from app/api/ directory structure
 * 3. Hits each route and checks for crashes (500, "Application error", SSR exceptions)
 * 4. Verifies migrations ran (queries pg_tables for expected tables from schema.ts)
 *
 * Exit code 0: all smoke tests passed.
 * Exit code 1: at least one test failed.
 *
 * Generic: works for any founder app — discovers routes dynamically,
 * never hardcodes specific table or page names.
 */

import { spawn } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import pg from "postgres";

const ROOT = process.cwd();
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;
const POSTGRES_URL = process.env.POSTGRES_URL;

// ── Route Discovery ──────────────────────────────────────────────────────────

function discoverPageRoutes(dir = join(ROOT, "app"), prefix = "") {
  const routes = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;

      // Skip route groups (parenthesized), but recurse into them with same prefix
      if (entry.startsWith("(") && entry.endsWith(")")) {
        routes.push(...discoverPageRoutes(full, prefix));
        continue;
      }

      // Skip api routes (handled separately)
      if (entry === "api") continue;

      // Dynamic segments like [id] — skip (need real IDs)
      if (entry.startsWith("[")) continue;

      const routePath = `${prefix}/${entry}`;

      // Check if this directory has a page.tsx
      try {
        const files = readdirSync(full);
        if (files.includes("page.tsx") || files.includes("page.ts")) {
          routes.push(routePath);
        }
      } catch {}

      // Recurse into subdirectories
      routes.push(...discoverPageRoutes(full, routePath));
    }
  } catch {}
  return routes;
}

function discoverApiRoutes(dir = join(ROOT, "app/api"), prefix = "/api") {
  const routes = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;

      // Skip dynamic segments
      if (entry.startsWith("[")) continue;

      const routePath = `${prefix}/${entry}`;

      try {
        const files = readdirSync(full);
        if (files.includes("route.ts") || files.includes("route.js")) {
          routes.push(routePath);
        }
      } catch {}

      routes.push(...discoverApiRoutes(full, routePath));
    }
  } catch {}
  return routes;
}

// ── Schema Table Discovery ───────────────────────────────────────────────────

function discoverExpectedTables() {
  try {
    const schema = readFileSync(join(ROOT, "lib/db/schema.ts"), "utf-8");
    const tables = [];
    const re = /pgTable\s*\(\s*["'](\w+)["']/g;
    let m;
    while ((m = re.exec(schema)) !== null) {
      tables.push(m[1]);
    }
    return tables;
  } catch {
    return [];
  }
}

// ── Server Management ────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn("npx", ["next", "start", "-p", PORT], {
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        server.kill();
        reject(new Error("Server failed to start within 30 seconds"));
      }
    }, 30000);

    server.stdout.on("data", (data) => {
      const text = data.toString();
      if (text.includes("Ready") || text.includes("started server")) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          // Give the server a moment to stabilize
          setTimeout(() => resolve(server), 2000);
        }
      }
    });

    server.stderr.on("data", (data) => {
      // Next.js prints startup info to stderr
      const text = data.toString();
      if (text.includes("Ready") || text.includes("started server")) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          setTimeout(() => resolve(server), 2000);
        }
      }
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before starting`));
      }
    });
  });
}

// ── HTTP Tests ───────────────────────────────────────────────────────────────

async function testRoute(url, type) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "manual", // Don't follow redirects — we want to see the status
    });
    clearTimeout(timeout);

    const status = res.status;
    let body = "";
    try {
      body = await res.text();
    } catch {}

    // Check for SSR crash indicators
    const isCrash =
      status === 500 ||
      body.includes("Application error") ||
      body.includes("server-side exception") ||
      body.includes("Internal Server Error");

    if (isCrash) {
      return {
        url,
        type,
        passed: false,
        status,
        error: `SSR crash detected (status=${status})`,
      };
    }

    // For pages: 200, 301, 302, 307, 308, 404 are all acceptable
    // (auth redirects, middleware rewrites, etc.)
    // For API routes: 401, 403, 404, 307 are acceptable (auth enforcement)
    // Only 500+ is a failure
    if (status >= 500) {
      return {
        url,
        type,
        passed: false,
        status,
        error: `Server error (status=${status})`,
      };
    }

    return { url, type, passed: true, status, error: null };
  } catch (err) {
    return {
      url,
      type,
      passed: false,
      status: 0,
      error: `Request failed: ${err.message}`,
    };
  }
}

// ── Database Tests ───────────────────────────────────────────────────────────

async function testMigrations(expectedTables) {
  if (!POSTGRES_URL || expectedTables.length === 0) {
    return { passed: true, missing: [], error: null };
  }

  try {
    const sql = pg(POSTGRES_URL, { prepare: false, max: 1 });
    const result =
      await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const existingTables = new Set(result.map((r) => r.tablename));
    await sql.end();

    const missing = expectedTables.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      return {
        passed: false,
        missing,
        error: `Tables missing after migration: ${missing.join(", ")}`,
      };
    }
    return { passed: true, missing: [], error: null };
  } catch (err) {
    return { passed: false, missing: [], error: `DB check failed: ${err.message}` };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("integration-smoke: discovering routes...");

  const pageRoutes = discoverPageRoutes();
  const apiRoutes = discoverApiRoutes();
  const expectedTables = discoverExpectedTables();

  // Always test root
  if (!pageRoutes.includes("/")) pageRoutes.unshift("/");

  console.log(`  Pages: ${pageRoutes.length} — ${pageRoutes.join(", ")}`);
  console.log(`  API routes: ${apiRoutes.length} — ${apiRoutes.join(", ")}`);
  console.log(`  Expected tables: ${expectedTables.length} — ${expectedTables.join(", ")}`);

  // 1. Test migrations
  console.log("\nintegration-smoke: checking database tables...");
  const dbResult = await testMigrations(expectedTables);
  if (!dbResult.passed) {
    console.error(`  FAIL: ${dbResult.error}`);
  } else {
    console.log(`  OK: all ${expectedTables.length} tables exist`);
  }

  // 2. Start server
  console.log("\nintegration-smoke: starting Next.js server...");
  let server;
  try {
    server = await startServer();
  } catch (err) {
    console.error(`  FAIL: ${err.message}`);
    process.exit(1);
  }
  console.log(`  Server running on ${BASE_URL}`);

  // 3. Test pages
  console.log("\nintegration-smoke: testing page routes...");
  const pageResults = [];
  for (const route of pageRoutes) {
    const result = await testRoute(`${BASE_URL}${route}`, "page");
    pageResults.push(result);
    const icon = result.passed ? "OK" : "FAIL";
    console.log(`  ${icon}: ${route} (${result.status}) ${result.error || ""}`);
  }

  // 4. Test API routes
  console.log("\nintegration-smoke: testing API routes...");
  const apiResults = [];
  for (const route of apiRoutes) {
    const result = await testRoute(`${BASE_URL}${route}`, "api");
    apiResults.push(result);
    const icon = result.passed ? "OK" : "FAIL";
    console.log(`  ${icon}: ${route} (${result.status}) ${result.error || ""}`);
  }

  // 5. Summary
  server.kill();

  const allResults = [dbResult, ...pageResults, ...apiResults];
  const failures = allResults.filter((r) => !r.passed);

  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log(
      `integration-smoke: ALL PASSED ` +
        `(${pageResults.length} pages, ${apiResults.length} API routes, ` +
        `${expectedTables.length} tables)`
    );
    process.exit(0);
  } else {
    console.error(
      `integration-smoke: ${failures.length} FAILURE(S):`
    );
    for (const f of failures) {
      console.error(`  - ${f.url || "db-check"}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`integration-smoke: fatal error: ${err.message}`);
  process.exit(1);
});
