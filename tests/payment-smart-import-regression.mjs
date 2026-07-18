// The former regression encoded the unsafe behavior (renewal click rewrote
// history and immediately generated future formal rows). It remains available
// in git history for incident reference.
// The active contract is now the guarded preview/insert-only workflow.
await import("./payment-safe-smart-import.mjs");
