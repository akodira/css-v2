/* Knowledge-base search (replaces the PostgreSQL tsvector + GIN index).
   Requires the Full-Text Search feature on the SQL Server instance.
   Language 1025 = Arabic, 1033 = English. */
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ccs_ft')
    CREATE FULLTEXT CATALOG ccs_ft;
GO
CREATE UNIQUE INDEX UX_kb_articles_ft_key ON ccs.kb_articles (id);  -- single-column unique key required by full-text
GO
CREATE FULLTEXT INDEX ON ccs.kb_articles (
    title_en LANGUAGE 1033, body_en LANGUAGE 1033,
    title_ar LANGUAGE 1025, body_ar LANGUAGE 1025)
KEY INDEX UX_kb_articles_ft_key ON ccs_ft WITH CHANGE_TRACKING AUTO;
GO
