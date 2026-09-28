/** Readable names for the models an answer can come from (spec §5.5): Binder's, and those a refusal falls back to. */
export const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-opus-5': 'Claude Opus 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-fable-5-1': 'Claude Fable 5.1',
}

/** A model id without a dated snapshot suffix ("claude-x-20260101" is "claude-x"), so the two compare equal. */
export const baseModel = (id: string) => id.replace(/-\d{8}$/, '')

/** A model's readable name, or its id when Binder doesn't know it. */
export const modelName = (id: string) => MODEL_NAMES[baseModel(id)] ?? id
