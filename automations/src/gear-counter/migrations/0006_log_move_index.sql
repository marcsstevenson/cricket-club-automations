-- Club pool taps find, update and delete a move's log pair by move_id (api/src/pool-taps.ts); without this each tap scans log.
CREATE INDEX log_move ON log (move_id) WHERE move_id IS NOT NULL;
