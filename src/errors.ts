export class ScreenAppBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScreenAppBridgeError";
  }
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof ScreenAppBridgeError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
