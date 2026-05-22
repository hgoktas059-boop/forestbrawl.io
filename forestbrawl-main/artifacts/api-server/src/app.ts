import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Trust Render/proxy reverse proxy (needed for correct req.ip, req.protocol)
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", router);

// ── Game static files ──────────────────────────────────────────────────────
// Resolve the forestbrawl directory robustly for both Replit and Render.
// At runtime __dirname is .../artifacts/api-server/dist/
// Going up 3 levels lands at the monorepo root, then descend into the game.
const candidatePaths = [
  join(__dirname, "../../../artifacts/forestbrawl"),  // from dist/ in monorepo
  join(process.cwd(), "artifacts/forestbrawl"),       // when cwd is monorepo root
  resolve("artifacts/forestbrawl"),                  // absolute fallback
];
const gameRoot = candidatePaths.find(existsSync) || candidatePaths[0];
logger.info({ gameRoot }, "Serving game static files");

// /forestbrawl/  → direct access (Render, curl)
// /api/forestbrawl/ → through Replit proxy (preview pane does NOT strip /api)
app.use("/forestbrawl", express.static(gameRoot, { maxAge: "1d", etag: true }));
app.use("/api/forestbrawl", express.static(gameRoot, { maxAge: "1d", etag: true }));

// Root → lobby page
app.get("/", (_req, res) => { res.redirect("/forestbrawl/index.html"); });

export default app;
