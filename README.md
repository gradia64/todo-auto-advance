# todo-auto-advance

A [dsh](https://github.com/deepseek-ai/deepseek-harness) plugin that keeps the
agent's todo list (`todo_write`) moving: once enough successful work has been
done on the `in_progress` todo, it is marked `completed` and the next `pending`
todo becomes `in_progress`.

If the agent works without a todo list, the plugin reminds it once per turn
to create one with `todo_write` after a few tool calls (`remindAfter`).

The agent stays in charge: whenever it writes the list itself, the plugin
drops the progress it has counted and starts again from zero.

## Configuration

Set in `cordis.patch.yml` (the values shown are the defaults):

```yaml
config:
  trigger: step          # 'step' | 'tool'
  tools: [write, edit, str_replace_editor, bash, pwsh]
  advanceAfter: 2
  resetOnError: true
  completeLast: false
  remindAfter: 5
```

| Option | Meaning |
| --- | --- |
| `trigger` | `step`: a model step counts once if at least one qualifying tool in it succeeded, however many ran in parallel. `tool`: every qualifying result counts on its own. |
| `tools` | Tool names whose results count as progress. `[]` means every tool except `todo_write`. |
| `advanceAfter` | How many qualifying steps (or results) complete the current todo. |
| `resetOnError` | A failed qualifying tool resets the progress counted for the current todo. |
| `completeLast` | Also complete the last in-progress todo when nothing is pending. |
| `remindAfter` | After this many tool calls in a turn without a todo list, remind the agent once to create one. `0` disables it. |
