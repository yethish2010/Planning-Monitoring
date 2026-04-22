import path from "path";
import { fileURLToPath } from "url";
import app, { startServer } from "./api/_server.ts";

const __filename = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isDirectExecution) {
  startServer();
}

export default app;
