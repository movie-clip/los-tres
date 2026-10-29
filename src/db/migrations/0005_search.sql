-- S5.4 search. The extension, the two text-search configurations and the three
-- functions come first: the generated column below depends on them.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION public.search_es (COPY = pg_catalog.spanish);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION public.search_es ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION public.search_simple (COPY = pg_catalog.simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION public.search_simple ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;--> statement-breakpoint
-- D-6: '5W-30', '5W 30', '5w30' all become '5w30'. Applied to titles and to terms; the only copy of the rule.
CREATE FUNCTION public.search_fold_codes(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT regexp_replace(t, '(^|[^[:alnum:]])([0-9]{1,2})[[:space:]]*[wW][[:space:]-]*([0-9]{1,3})(?![[:alnum:]])', '\1\2w\3', 'g')
$$;--> statement-breakpoint
-- One word: its Spanish stem OR its unstemmed form; NULL when Spanish drops it as a stop word.
CREATE FUNCTION public.search_word_query(w text) RETURNS tsquery LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN numnode(plainto_tsquery('public.search_es'::regconfig, w)) = 0 THEN NULL
    ELSE plainto_tsquery('public.search_es'::regconfig, w) || plainto_tsquery('public.search_simple'::regconfig, w) END
$$;--> statement-breakpoint
-- The term: every remaining word required (AND). NULL when no word remains.
CREATE FUNCTION public.search_text_query(term text) RETURNS tsquery LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT string_agg('(' || q::text || ')', ' & ')::tsquery
  FROM (SELECT public.search_word_query(w) AS q
        FROM regexp_split_to_table(public.search_fold_codes(term), '[[:space:]]+') AS w) s
  WHERE q IS NOT NULL
$$;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('public.search_es'::regconfig, public.search_fold_codes(title)) || to_tsvector('public.search_simple'::regconfig, coalesce(brand, ''))) STORED;--> statement-breakpoint
CREATE INDEX "products_part_number_normalised_idx" ON "products" USING btree ("part_number_normalised");--> statement-breakpoint
CREATE INDEX "products_search_vector_idx" ON "products" USING gin ("search_vector");
