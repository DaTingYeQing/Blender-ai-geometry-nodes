export const EVENTS = Object.freeze({
  AGENTS_CHANGED: "agents.changed",
  FLOW_ADD_NODE: "flow.add-node",
  RUN_CHANGED: "run.changed",
  RUN_REQUEST: "run.request",
  RUN_ABORT: "run.abort",
});

export function createEvents() {
  const listeners = new Map();

  return {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
    emit(type, payload) {
      for (const listener of listeners.get(type) || []) listener(payload);
    },
  };
}
