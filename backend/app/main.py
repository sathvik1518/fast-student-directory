from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.gzip import GZipMiddleware

from app.db import DEFAULT_PATH, QueryCounter, connect, ensure_database
from app.queries import list_students


def create_app(db_path: str | Path | None = None) -> FastAPI:
    path = ensure_database(db_path or DEFAULT_PATH)
    app = FastAPI(title="Student Directory API")
    # Compression: the list is repeated text, so gzip makes it several times smaller on the wire.
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/students")
    def students(response: Response) -> list[dict]:
        counter = QueryCounter()
        started = time.perf_counter()
        conn = connect(path, counter)
        try:
            rows = list_students(conn)
        finally:
            conn.close()
        response.headers["X-Query-Count"] = str(counter.count)
        response.headers["Server-Timing"] = f"db;dur={(time.perf_counter() - started) * 1000:.1f}"
        response.headers["Access-Control-Expose-Headers"] = "X-Query-Count, Server-Timing"
        # Plain dicts, no response model on purpose: the rows are returned as they are in the database,
        # including the 4 broken legacy rows. The page, not the API, decides how to show a broken row.
        return rows

    return app
