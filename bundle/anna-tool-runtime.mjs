/* Small, host-agnostic boundary for Anna tool invocation. */
export function invokeAnnaTool(anna, request, options = {}) {
  const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
    ? request.timeoutMs
    : undefined;
  const invokeOptions = timeoutMs ? { ...options, timeoutMs } : options;

  // Anna's synchronous invoke path is capped at 90 seconds. Longer calls use
  // the durable async job API and receive the same timeout in both places:
  // the job request and the SDK wait options.
  if (timeoutMs > 90000) {
    if (typeof anna.tools.invokeAsyncAwait !== "function") {
      throw new Error("This Anna host SDK does not expose invokeAsyncAwait; update the Anna app runtime before running this long task.");
    }
    return anna.tools.invokeAsyncAwait(request, invokeOptions);
  }
  return anna.tools.invoke(request, invokeOptions);
}
