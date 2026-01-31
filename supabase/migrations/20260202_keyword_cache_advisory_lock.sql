-- Stampede protection: advisory lock keyed by cache_key so only one request builds cache per keyword.
-- Use pg_try_advisory_lock(hashtext(cache_key)::bigint) — session-level lock, released on unlock or disconnect.

CREATE OR REPLACE FUNCTION try_lock_keyword_cache(p_cache_key text)
RETURNS boolean
LANGUAGE sql
STRICT
AS $$
  SELECT pg_try_advisory_lock(hashtext(p_cache_key)::bigint);
$$;

CREATE OR REPLACE FUNCTION unlock_keyword_cache(p_cache_key text)
RETURNS boolean
LANGUAGE sql
STRICT
AS $$
  SELECT pg_advisory_unlock(hashtext(p_cache_key)::bigint);
$$;
