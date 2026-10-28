# Architecture

- Keep custom food and AI proxy dispatch in `src/worker.ts` using Worker env bindings; this deployment uses a single Worker rather than Pages functions.