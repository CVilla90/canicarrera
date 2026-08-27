# Canicarrera contributor instructions

These instructions apply to the entire `Canicarrera/` project. They are written
for human contributors and automated coding assistants alike; no particular AI
vendor, editor, shell extension, or private conversation history is assumed.

## Read order

1. `README.md` — product and architecture overview.
2. `docs/CURRENT_WORK.md` — latest checkpoint, verification, and next safe step.
3. `docs/DEVELOPMENT.md` — durable engineering and QA conventions.
4. `HANDOFF.md` — detailed history, measurements, and older decisions.
5. `PLAN.md` — product strategy and longer roadmap.

When these disagree about current implementation status, prefer
`docs/CURRENT_WORK.md`, then confirm against the code and `git status`.

## Workspace and commands

- This folder is its own Git repository. Run project commands from
  `Canicarrera/`, not from the parent Brainstorm workspace.
- Use the scripts in `package.json`; do not invent a second build or test path.
- Standard verification is `npm run check`, `npm test`, and `npm run build`.
- On Windows PowerShell, use `npm.cmd` if script policy blocks `npm.ps1`.
- The worktree may already contain valuable uncommitted work. Inspect
  `git status --short` and focused diffs first. Never reset or overwrite changes
  merely because they are not in `HEAD`.
- Do not commit, push, deploy, or rewrite repository history unless the user
  explicitly requests it.

## Architectural invariants

- The server invents; the client draws. `shared/` must remain free of DOM,
  Three.js, React, Web Audio, and renderer state.
- A visual feature must not affect race physics, RNG consumption, finish order,
  or timing. Use a named cosmetic RNG stream for deterministic decoration.
- Preview and exported MP4 must agree. Animate scene elements from simulation
  time, never wall-clock time.
- Preserve fixed-step determinism. Changes to physics, arc sampling, or race
  state may require `SIM_VERSION`; cosmetic work normally does not.
- Dispose GPU geometry, materials, textures, render targets, listeners, and
  timers when replacing a race or unmounting the app.
- Keep Spanish and English strings together in `client/i18n.ts`; do not place
  new user-facing prose directly in components.
- Design for phones first. Treat WebGL memory, drawing-buffer size, and overlay
  area as budgets rather than unlimited resources.

## Collaboration and continuity

- Keep durable reasoning in ordinary Markdown or source comments, not in a
  tool-specific memory feature.
- After a meaningful checkpoint, update `docs/CURRENT_WORK.md` with behavior,
  files touched, tests run, open risks, and the next restart point.
- Update `docs/DEVELOPMENT.md` only for conventions that should remain true
  across many checkpoints. Keep historical detail in `HANDOFF.md`.
- Make focused edits. If another contributor has touched the same file, preserve
  their work and document the overlap.
- A checkpoint is complete only when typecheck and relevant tests pass. Run the
  production build for changes to React, rendering, export, or bundling.
- Record manual browser/device checks honestly. Never turn an unperformed phone
  or fullscreen test into a claimed result.

