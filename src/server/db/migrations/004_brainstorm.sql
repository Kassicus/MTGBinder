-- Brainstorm (spec §4.1, §5.5): `ai_threads` and `ai_messages` exist since 001. An assistant message's `meta` is JSON
-- about it: the model that wrote it, why it stopped, and its token usage.
ALTER TABLE ai_messages ADD COLUMN meta TEXT;
CREATE INDEX ai_messages_thread ON ai_messages (thread_id, id);
