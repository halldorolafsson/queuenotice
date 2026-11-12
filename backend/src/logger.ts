import pino from "pino";
import { config } from "./config.js";

// Cloud Logging leser feltet "severity" og "message".
export const logger = pino({
  level: config.LOG_LEVEL,
  messageKey: "message",
  formatters: {
    level: (label) => ({ severity: label.toUpperCase() }),
  },
  redact: {
    paths: ["*.email", "*.endpoint", "*.p256dh", "*.auth", "req.headers.cookie", "req.headers.authorization"],
    censor: "[skjult]",
  },
});
