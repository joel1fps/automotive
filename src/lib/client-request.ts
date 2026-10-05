// Retry the same payload with the same key after an ambiguous network response.
// Keep this identity in the mounted form; successful submissions reset it.
export function createRequestIdentity() {
  let current: { payload: string; id: string } | null = null;
  return {
    get(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (!current || current.payload !== serialized)
        current = { payload: serialized, id: crypto.randomUUID() };
      return current.id;
    },
    reset() { current = null; },
  };
}
