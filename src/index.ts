/**
 * AnchorNet API – entry point.
 * Builds the application and starts the HTTP server.
 */

import { Express } from "express";
import { createApp, getConfig } from "./app";
import { createShutdownHandler } from "./utils/shutdown";
import { markNotReady } from "./utils/readiness";

// Build (and validate) the app up front. validateConfig() runs inside
// createApp()/getConfig() and throws a ConfigValidationError naming the
// missing variable when a required value is absent, refusing to start
// instead of silently running with weakened configuration.
let app: Express;
try {
  app = createApp();
} catch (error) {
  if (process.env.NODE_ENV !== "test") {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`AnchorNet API failed to start: ${message}`);
    process.exit(1);
  }
  throw error;
}

if (process.env.NODE_ENV !== "test") {
  try {
    const { port: PORT } = getConfig();
    const server = app.listen(PORT, () => {
      console.log(`AnchorNet API listening on http://localhost:${PORT}`);
    });

    const shutdown = createShutdownHandler(server, {
      onShutdown: (signal) => {
        markNotReady();
        console.log(`${signal} received, shutting down`);
      },
    });
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`AnchorNet API failed to start: ${message}`);
    process.exit(1);
  }
}

export default app;
