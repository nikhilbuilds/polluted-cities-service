import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

const app = createApp();
const server = createServer(app);

server.listen(env.port, () => {
  logger.info(`Server listening on port ${env.port}`);
});
