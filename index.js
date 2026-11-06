export const name = 'todo-auto-advance';
export const inject = ['tools', 'sessionProjections'];

// The exact name registered by @deepseek-ai/dsh-tool-todo.
const TODO_TOOL = 'todo_write';

export const defaults = Object.freeze({
  // 'step': at most one advance per model step, however many tools ran in it.
  // 'tool': every qualifying tool result counts on its own (1.0.x behaviour).
  trigger: 'step',
  // Tools whose successful results count as progress on the current todo.
  // An empty list means every tool except todo_write.
  tools: ['write', 'edit', 'str_replace_editor', 'bash', 'pwsh'],
  // Qualifying steps (or results, with trigger 'tool') needed before the
  // in-progress todo is marked completed.
  advanceAfter: 2,
  // A failed qualifying tool resets the progress counted for the current todo.
  resetOnError: true,
  // Whether to complete the last in-progress todo when nothing is pending.
  completeLast: false,
});

export function normalizeConfig(config = {}) {
  const c = { ...defaults, ...(config || {}) };
  const trigger = c.trigger === 'tool' ? 'tool' : 'step';
  const tools = Array.isArray(c.tools)
    ? c.tools.map(t => String(t).trim()).filter(Boolean)
    : [...defaults.tools];
  const n = Number(c.advanceAfter);
  const advanceAfter = Number.isInteger(n) && n >= 1 ? n : defaults.advanceAfter;
  return {
    trigger,
    tools: new Set(tools),
    advanceAfter,
    resetOnError: c.resetOnError !== false,
    completeLast: c.completeLast === true,
  };
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const counts = (toolName) =>
    toolName !== TODO_TOOL && (config.tools.size === 0 || config.tools.has(toolName));

  // Per-session tracking:
  //   item      content of the in-progress todo the counter refers to
  //   count     qualifying evidence gathered for that item
  //   step      evidence buffered for the current step (trigger 'step')
  //   ownWrite  JSON of the last list this plugin wrote, to tell our writes
  //             apart from the agent's own todo_write calls
  const trackers = new Map();
  const tracker = (session) => {
    let t = trackers.get(session);
    if (!t) {
      t = { item: undefined, count: 0, step: freshStep(), ownWrite: undefined };
      trackers.set(session, t);
    }
    return t;
  };
  const freshStep = () => ({ ok: false, err: false, manual: false });

  // Per-session write queue: advances must not interleave their
  // read-modify-write cycles on the todo list.
  const queues = new Map();
  function serialize(session, task) {
    const tail = queues.get(session) || Promise.resolve();
    const next = tail.then(task, task);
    const settle = next.catch(() => {});
    settle.then(() => {
      if (queues.get(session) === settle) queues.delete(session);
    });
    queues.set(session, settle);
    return next;
  }

  // Apply one unit of evidence (a step, or a single result) to the session.
  async function evaluate(session, { ok, err }) {
    const t = tracker(session);
    const todos = ctx.sessionProjections.stateOf(session, 'todos');
    if (!Array.isArray(todos) || todos.length === 0) return;
    const current = todos.findIndex(x => x.status === 'in_progress');
    if (current === -1) return;

    // The counter belongs to one todo: a different in-progress item (set by
    // the agent, or seen for the first time) starts again from zero.
    if (t.item !== todos[current].content) {
      t.item = todos[current].content;
      t.count = 0;
    }

    if (err && config.resetOnError) {
      t.count = 0;
      return;
    }
    if (!ok) return;
    t.count += 1;
    if (t.count < config.advanceAfter) return;

    const newTodos = todos.map((x, i) =>
      i === current ? { ...x, status: 'completed' } : x
    );
    const nextPending = newTodos.findIndex(x => x.status === 'pending');
    if (nextPending === -1 && !config.completeLast) return;
    if (nextPending !== -1) {
      newTodos[nextPending] = { ...newTodos[nextPending], status: 'in_progress' };
    }

    t.ownWrite = JSON.stringify(newTodos);
    t.item = nextPending === -1 ? undefined : newTodos[nextPending].content;
    t.count = 0;
    const written = session.append('todo/write', { todos: newTodos });
    // If the harness returns a promise, hold the lock until the write
    // settles so the next queued advance reads a fresh projection.
    if (written && typeof written.then === 'function') await written;
  }

  function schedule(session, evidence) {
    serialize(session, async () => {
      try {
        await evaluate(session, evidence);
      } catch (e) {
        ctx.logger.warn('todo-auto-advance: failed to advance todos:', e);
      }
    });
  }

  ctx.on('tools/result', (exec, result) => {
    const session = exec && exec.agent && exec.agent.session;
    if (!session || !result) return;
    if (!counts(String(exec.name || ''))) return;
    const evidence = { ok: !result.isError, err: !!result.isError };
    if (config.trigger === 'tool') {
      schedule(session, evidence);
    } else {
      const step = tracker(session).step;
      step.ok = step.ok || evidence.ok;
      step.err = step.err || evidence.err;
    }
  });

  ctx.on('session/event', (session, event) => {
    if (!event) return;
    switch (event.type) {
      case 'todo/write': {
        const t = trackers.get(session);
        if (!t) return;
        const data = event.data && event.data.todos;
        if (t.ownWrite !== undefined && JSON.stringify(data) === t.ownWrite) {
          t.ownWrite = undefined;
          return;
        }
        // The agent is managing the list itself: drop what we counted so far
        // and ignore the rest of this step.
        t.item = undefined;
        t.count = 0;
        t.step.manual = true;
        return;
      }
      case 'step/end': {
        const t = trackers.get(session);
        if (!t) return;
        const step = t.step;
        t.step = freshStep();
        if (config.trigger !== 'step' || step.manual) return;
        if (step.ok || step.err) schedule(session, step);
        return;
      }
      case 'turn/start':
        // The todos projection resets at every turn start.
        trackers.delete(session);
        return;
    }
  });

  ctx.on('session/disposed', (session) => {
    trackers.delete(session);
    queues.delete(session);
  });
}
