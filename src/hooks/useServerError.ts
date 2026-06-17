import { AppError } from "@/lib/errors";

export function getErrorMessage(err: unknown): string {
  if (err instanceof AppError || (err as any)?.name === "AppError") {
    return (err as any).message ?? "אירעה שגיאה, נסה שוב";
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "אירעה שגיאה, נסה שוב";
}
