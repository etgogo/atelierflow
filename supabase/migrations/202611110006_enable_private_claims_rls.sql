-- Migration 06: defense-in-depth protection for the private garage bootstrap claim table.
-- Applied to Supabase project abzxrwivnqljmjfkchjb and verified via pg_class.relrowsecurity.

ALTER TABLE atelierflow_private.garage_creation_claims
ENABLE ROW LEVEL SECURITY;
