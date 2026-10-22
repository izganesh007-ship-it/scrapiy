-- Database schema for Scrapiy (Cloudflare D1 = SQLite)
CREATE TABLE IF NOT EXISTS scraped_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    data TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scraped_job_id ON scraped_records(job_id);
CREATE INDEX IF NOT EXISTS idx_scraped_status ON scraped_records(status);
CREATE INDEX IF NOT EXISTS idx_scraped_created_at ON scraped_records(created_at);