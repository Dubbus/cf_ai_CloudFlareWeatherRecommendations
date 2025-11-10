## Quick orientation

- Repo layout (discoverable):
  - `README.md` — top-level project README (contains a short description).
  - `prompts.md` — present but currently empty; intended place for human/agent prompts and task guidance.
  - `frontend/` — folder exists but is currently empty (expected web client code goes here).
  - `worker/` — folder exists but is currently empty (expected backend/worker code goes here).

## Big-picture guidance for an AI coding agent

- This repo is a tiny scaffold for a split frontend/worker project. There are no build files, package manifests, or tests checked in yet. Any change that adds code should also add the minimal build/test metadata (e.g., `package.json` for JS/TS, or `pyproject.toml`/`requirements.txt` for Python) in the component directory you modify.
- Primary places to read/update:
  - `prompts.md` — record and consult here: high-level goals, prompt templates, or human-side instructions. It's the canonical place in-repo for conversational/task prompts.
  - `README.md` — update with one-line build/run instructions when you add a component.

## Conventions and actionable rules (from what is discoverable)

- Keep changes local to the component you add: add `frontend/package.json` if adding a web client, or `worker/package.json`/`requirements.txt` if adding server code. Do not put component-specific manifests in the root unless you intentionally add a monorepo setup.
- When creating new files, include a one-line note in `README.md` with commands to build and run that component (example: `cd frontend; npm install; npm run dev`). This repo currently lacks CI/config files; leave a short run-note to help maintainers.
- Commit message style: not enforced by files, so use clear, imperative messages (e.g., `feat(worker): add basic weather poller and README run note`).

## Integration points & external dependencies (discovered)

- None are present in the repository. If you integrate external services (APIs, cloud), register keys/out-of-repo secrets — do NOT commit secrets; add usage notes in `README.md` and reference environment variables.

## Examples (how to act in this codebase)

- If adding a React frontend:
  - Create `frontend/package.json` with scripts `dev`, `build`, `test`.
  - Add a one-line dev instruction to root `README.md` and a brief summary in `prompts.md` about why the UI exists and what to test.

- If adding a worker/service:
  - Create `worker/requirements.txt` or `worker/package.json` and a short `worker/README.md` explaining how to run it locally and expected inputs/outputs.

## What to avoid

- Don't invent project-wide orchestration (monorepo tools, CI) unless requested. This repo is intentionally minimal—prefer conservative, component-scoped changes.

## When you're unsure

- Ask a human before making assumptions that affect repo layout (for example, adding a root-level build system or CI). If a human is unavailable, add clear notes in `README.md` and `prompts.md` describing the assumptions you made.

## Quick checklist for PRs created by an agent

1. Add/modify files for a single feature or component only.
2. Include component-local manifest (package.json / requirements.txt) if you add code.
3. Add one-line dev/run instructions to `README.md`.
4. Update `prompts.md` with the intent of the change and any human-facing tests to run.

---
If anything above is ambiguous or you'd like the instructions tailored for a preferred stack (Node, Python, etc.), tell me which stack to target and I'll update this file.
