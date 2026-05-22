import app from "./app";
import { createGameServer } from "./game-server";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createGameServer(app);

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
