-- ════════════════════════════════════════════════════════════════
-- KEYSTONE OS — Sprint 6 : table screenshots (fiches Key-Store)
-- Auto-appliquée par le Worker à la première requête /api/admin/screenshot
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS screenshots (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    app_id      TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    mime        TEXT NOT NULL DEFAULT 'image/jpeg',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_screenshots_app
    ON screenshots(tenant_id, app_id);
