type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
