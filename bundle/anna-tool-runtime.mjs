/* Small, host-agnostic boundary for Anna tool invocation. */
export function invokeAnnaTool(anna, request, options = {}) {
  const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
    ? request.timeoutMs
    : undefined;
  const invokeOptions = timeoutMs ? { ...options, timeoutMs } : options;

  // Anna's synchronous invoke path is capped at 90 seconds. Longer calls use
  // the durable async job API. The request timeout is the plugin job deadline;
  // invokeAsyncAwait has a separate client wall-clock timeout. Explicitly
  // mirror the requested job budget plus the SDK's 30s grace here: local Anna
  // hosts can report a deadline in a skewed clock domain, making the SDK's
  // derived wait collapse to its 30s grace and falsely fail long jobs.
  if (timeoutMs > 90000) {
    if (typeof anna.tools.invokeAsyncAwait !== "function") {
      throw new Error("This Anna host SDK does not expose invokeAsyncAwait; update the Anna app runtime before running this long task.");
    }
    const waitOptions = { ...options, timeoutMs: timeoutMs + 30000 };
    return anna.tools.invokeAsyncAwait(request, waitOptions);
  }
  return anna.tools.invoke(request, invokeOptions);
}
