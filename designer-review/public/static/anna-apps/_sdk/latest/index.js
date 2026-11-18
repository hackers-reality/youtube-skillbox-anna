// Standalone-only host shim for the design-review build.
// It intentionally provides no Anna credentials, tools, storage, or LLM access.
const AnnaAppRuntime = {
  async connect() {
    throw new Error("Design-review preview: Anna host is intentionally unavailable.");
  },
};

export { AnnaAppRuntime };
