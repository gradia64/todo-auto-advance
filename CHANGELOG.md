# Changelog

## 1.0.2

- Added configuration (see `README.md`): `trigger`, `tools`, `advanceAfter`,
  `resetOnError`, `completeLast`.
- A todo is no longer completed by the first tool result: by default it needs
  progress in 2 model steps (`advanceAfter`), counting only tools that change
  something (`write`, `edit`, `str_replace_editor`, `bash`, `pwsh`). Reads and
  searches no longer advance the list.
- With the default `trigger: step`, tools run in parallel within one model step
  count once, so N parallel results no longer complete N todos.
- When the agent writes the todo list itself with `todo_write`, the progress
  counted so far is discarded and the rest of that step is ignored, so the
  plugin no longer completes a todo the agent has just set `in_progress`.
- A failed qualifying tool resets the progress counted for the current todo
  (`resetOnError`).
- The last in-progress todo is no longer completed automatically when nothing
  is pending (`completeLast: false`); finishing the list is left to the agent.
- Own writes are now recognised by matching only the exact `todo_write` tool
  name, instead of a loose normalisation that could also skip unrelated tools.
- Per-session state is cleared on `turn/start` and `session/disposed`.

## 1.0.1

- Fixed a potential feedback loop: tool results produced by the plugin's own
  `todo/write` command are now ignored regardless of the naming variant the
  harness reports (`todo_write`, `todo/write`, `todo-write`, ...). Previously
  only the exact name `todo_write` was skipped, so a harness reporting the
  appended command under a different spelling could trigger a cascade that
  auto-completed the whole todo list.
- The read-modify-write cycle on the todo list is now serialized per session,
  preventing lost updates when parallel tool results interleave. When
  `session.append` returns a promise, the write queue waits for it to settle
  before the next advance, so queued advances always read a fresh projection
  instead of issuing duplicate redundant writes.
- Todo entries are now copied with all their fields; extra metadata such as
  ids or priorities is no longer stripped when advancing the list.
- Guarded against a missing `result` payload.
- Failures are now reported via `ctx.logger.warn` instead of being silently
  swallowed.

## 1.0.0

- Initial release.
