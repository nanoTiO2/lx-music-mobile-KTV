from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / "codex_lx二开_log.db"
TZ_UTC_8 = timezone(timedelta(hours=8))


def now_iso() -> str:
    return datetime.now(TZ_UTC_8).isoformat(timespec="milliseconds")


def connect_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table_name,),
    ).fetchone()
    return row is not None


def has_column(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    columns = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(column["name"] == column_name for column in columns)


def ensure_column(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_sql: str,
) -> None:
    if has_table(conn, table_name) and not has_column(conn, table_name, column_name):
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")


def init_db(db_path: Path) -> None:
    with closing(connect_db(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS task_sessions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_requirement TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              user_requirement TEXT NOT NULL,
              thinking_path TEXT NOT NULL DEFAULT '',
              key_steps TEXT NOT NULL DEFAULT '',
              code_snippet TEXT NOT NULL DEFAULT '',
              error_message TEXT NOT NULL DEFAULT '',
              fix_record TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_artifacts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              artifact_type TEXT NOT NULL,
              artifact_path TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS sessions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              user_requirement TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'planning'
            );

            CREATE TABLE IF NOT EXISTS artifacts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              artifact_type TEXT NOT NULL,
              artifact_path TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS agent_activity (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              activity_type TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'running'
            );

            CREATE TABLE IF NOT EXISTS issues (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              issue_key TEXT NOT NULL,
              issue_summary TEXT NOT NULL,
              root_cause TEXT NOT NULL DEFAULT '',
              resolution TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'open'
            );

            CREATE TABLE IF NOT EXISTS decisions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              user_name TEXT NOT NULL DEFAULT '',
              agent_name TEXT NOT NULL DEFAULT '',
              decision_key TEXT NOT NULL,
              decision_summary TEXT NOT NULL,
              rationale TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'accepted'
            );

            CREATE INDEX IF NOT EXISTS idx_task_sessions_task
              ON task_sessions(task_id, session_id);

            CREATE INDEX IF NOT EXISTS idx_task_logs_task
              ON task_logs(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_task_artifacts_task
              ON task_artifacts(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_sessions_task
              ON sessions(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_artifacts_task
              ON artifacts(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_agent_activity_task
              ON agent_activity(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_issues_task
              ON issues(task_id, session_id, timestamp);

            CREATE INDEX IF NOT EXISTS idx_decisions_task
              ON decisions(task_id, session_id, timestamp);
            """
        )
        ensure_column(conn, "task_logs", "user_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "task_logs", "agent_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "task_artifacts", "user_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "task_artifacts", "agent_name", "TEXT NOT NULL DEFAULT ''")
        conn.commit()


def upsert_session(
    db_path: Path,
    task_id: str,
    session_id: str,
    user_requirement: str,
    summary: str,
    status: str,
) -> None:
    timestamp = now_iso()
    with closing(connect_db(db_path)) as conn:
        existing = conn.execute(
            """
            SELECT id
            FROM task_sessions
            WHERE task_id = ? AND session_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (task_id, session_id),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE task_sessions
                SET user_requirement = ?,
                    summary = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (user_requirement, summary, status, timestamp, existing["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO task_sessions (
                  task_id, session_id, user_requirement, summary, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, session_id, user_requirement, summary, status, timestamp, timestamp),
            )
        conn.commit()


def append_log(
    db_path: Path,
    task_id: str,
    session_id: str,
    user_requirement: str,
    thinking_path: str,
    key_steps: str,
    code_snippet: str,
    error_message: str,
    fix_record: str,
    status: str,
    user_name: str = "",
    agent_name: str = "",
) -> None:
    with closing(connect_db(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO task_logs (
              timestamp, task_id, session_id, user_name, agent_name, user_requirement,
              thinking_path, key_steps, code_snippet, error_message, fix_record, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_iso(),
                task_id,
                session_id,
                user_name,
                agent_name,
                user_requirement,
                thinking_path,
                key_steps,
                code_snippet,
                error_message,
                fix_record,
                status,
            ),
        )
        conn.commit()


def add_artifact(
    db_path: Path,
    task_id: str,
    session_id: str,
    artifact_type: str,
    artifact_path: str,
    description: str,
    user_name: str = "",
    agent_name: str = "",
) -> None:
    with closing(connect_db(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO task_artifacts (
              timestamp, task_id, session_id, user_name, agent_name, artifact_type, artifact_path, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (now_iso(), task_id, session_id, user_name, agent_name, artifact_type, artifact_path, description),
        )
        conn.commit()


def add_session_record(
    db_path: Path,
    task_id: str,
    session_id: str,
    user_requirement: str,
    summary: str,
    status: str,
    user_name: str = "",
    agent_name: str = "",
) -> None:
    with closing(connect_db(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO sessions (
              timestamp, task_id, session_id, user_name, agent_name, user_requirement, summary, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (now_iso(), task_id, session_id, user_name, agent_name, user_requirement, summary, status),
        )
        conn.commit()


def add_decision(
    db_path: Path,
    task_id: str,
    session_id: str,
    decision_key: str,
    decision_summary: str,
    rationale: str,
    status: str = "accepted",
    user_name: str = "",
    agent_name: str = "",
) -> None:
    with closing(connect_db(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO decisions (
              timestamp, task_id, session_id, user_name, agent_name, decision_key, decision_summary, rationale, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (now_iso(), task_id, session_id, user_name, agent_name, decision_key, decision_summary, rationale, status),
        )
        conn.commit()


@dataclass
class HistorySummary:
    unresolved_issues: list[str]
    last_step: str
    reusable_items: list[str]

    def as_text(self) -> str:
        return json.dumps(
            {
                "unresolved_issues": self.unresolved_issues,
                "last_step": self.last_step,
                "reusable_items": self.reusable_items,
            },
            ensure_ascii=False,
            indent=2,
        )


def summarize_history(db_path: Path, task_id: str | None = None) -> HistorySummary:
    unresolved_issues: list[str] = []
    reusable_items: list[str] = []
    last_step = ""
    with closing(connect_db(db_path)) as conn:
        params: tuple[Any, ...] = ()
        session_where = ""
        log_where = ""
        if task_id:
            session_where = "WHERE task_id = ?"
            log_where = "WHERE task_id = ?"
            params = (task_id,)

        latest_session = conn.execute(
            f"""
            SELECT task_id, session_id, status, summary, updated_at
            FROM task_sessions
            {session_where}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            params,
        ).fetchone()

        latest_log = conn.execute(
            f"""
            SELECT key_steps, thinking_path, error_message, fix_record, status
            FROM task_logs
            {log_where}
            ORDER BY timestamp DESC, id DESC
            LIMIT 1
            """,
            params,
        ).fetchone()

        error_logs = conn.execute(
            f"""
            SELECT error_message, fix_record
            FROM task_logs
            {log_where}
              {"AND" if log_where else "WHERE"} status = 'error'
            ORDER BY timestamp DESC, id DESC
            LIMIT 5
            """,
            params,
        ).fetchall()

        artifact_rows = conn.execute(
            f"""
            SELECT artifact_type, artifact_path, description
            FROM task_artifacts
            {log_where}
            ORDER BY timestamp DESC, id DESC
            LIMIT 8
            """,
            params,
        ).fetchall()

    if latest_log:
        last_step = latest_log["key_steps"] or latest_log["thinking_path"] or ""
    elif latest_session:
        last_step = latest_session["summary"] or ""

    for row in error_logs:
        error_message = (row["error_message"] or "").strip()
        fix_record = (row["fix_record"] or "").strip()
        unresolved_issues.append(error_message if not fix_record else f"{error_message} | 修复: {fix_record}")

    if latest_session and latest_session["status"] not in {"done", "fixed"}:
        summary = (latest_session["summary"] or "").strip()
        if summary:
            unresolved_issues.insert(0, summary)

    for row in artifact_rows:
        item = f"{row['artifact_type']}: {row['artifact_path']}"
        if row["description"]:
            item = f"{item} | {row['description']}"
        reusable_items.append(item)

    return HistorySummary(
        unresolved_issues=unresolved_issues,
        last_step=last_step,
        reusable_items=reusable_items,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Codex SQLite task logger")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite db path")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Initialize database and upsert session")
    init_parser.add_argument("--task-id", required=True)
    init_parser.add_argument("--session-id", required=True)
    init_parser.add_argument("--requirement", required=True)
    init_parser.add_argument("--summary", default="")
    init_parser.add_argument("--status", default="planning")
    init_parser.add_argument("--user-name", default="")
    init_parser.add_argument("--agent-name", default="")

    log_parser = subparsers.add_parser("log", help="Append one task log")
    log_parser.add_argument("--task-id", required=True)
    log_parser.add_argument("--session-id", required=True)
    log_parser.add_argument("--requirement", required=True)
    log_parser.add_argument("--thinking-path", default="")
    log_parser.add_argument("--key-steps", default="")
    log_parser.add_argument("--code-snippet", default="")
    log_parser.add_argument("--error-message", default="")
    log_parser.add_argument("--fix-record", default="")
    log_parser.add_argument("--status", default="running")
    log_parser.add_argument("--user-name", default="")
    log_parser.add_argument("--agent-name", default="")

    artifact_parser = subparsers.add_parser("artifact", help="Record generated artifact")
    artifact_parser.add_argument("--task-id", required=True)
    artifact_parser.add_argument("--session-id", required=True)
    artifact_parser.add_argument("--type", required=True, dest="artifact_type")
    artifact_parser.add_argument("--path", required=True, dest="artifact_path")
    artifact_parser.add_argument("--description", default="")
    artifact_parser.add_argument("--user-name", default="")
    artifact_parser.add_argument("--agent-name", default="")

    decision_parser = subparsers.add_parser("decision", help="Record architecture or implementation decision")
    decision_parser.add_argument("--task-id", required=True)
    decision_parser.add_argument("--session-id", required=True)
    decision_parser.add_argument("--key", required=True, dest="decision_key")
    decision_parser.add_argument("--summary", required=True, dest="decision_summary")
    decision_parser.add_argument("--rationale", default="")
    decision_parser.add_argument("--status", default="accepted")
    decision_parser.add_argument("--user-name", default="")
    decision_parser.add_argument("--agent-name", default="")

    summary_parser = subparsers.add_parser("summary", help="Summarize history")
    summary_parser.add_argument("--task-id")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    db_path = Path(args.db).expanduser().resolve()
    init_db(db_path)

    if args.command == "init":
        upsert_session(db_path, args.task_id, args.session_id, args.requirement, args.summary, args.status)
        add_session_record(
            db_path,
            args.task_id,
            args.session_id,
            args.requirement,
            args.summary,
            args.status,
            user_name=args.user_name,
            agent_name=args.agent_name,
        )
        print(json.dumps({"db": str(db_path), "status": "initialized"}, ensure_ascii=False))
        return 0

    if args.command == "log":
        append_log(
            db_path=db_path,
            task_id=args.task_id,
            session_id=args.session_id,
            user_requirement=args.requirement,
            thinking_path=args.thinking_path,
            key_steps=args.key_steps,
            code_snippet=args.code_snippet,
            error_message=args.error_message,
            fix_record=args.fix_record,
            status=args.status,
            user_name=args.user_name,
            agent_name=args.agent_name,
        )
        print(json.dumps({"db": str(db_path), "status": "logged"}, ensure_ascii=False))
        return 0

    if args.command == "artifact":
        add_artifact(
            db_path=db_path,
            task_id=args.task_id,
            session_id=args.session_id,
            artifact_type=args.artifact_type,
            artifact_path=args.artifact_path,
            description=args.description,
            user_name=args.user_name,
            agent_name=args.agent_name,
        )
        print(json.dumps({"db": str(db_path), "status": "artifact_recorded"}, ensure_ascii=False))
        return 0

    if args.command == "decision":
        add_decision(
            db_path,
            args.task_id,
            args.session_id,
            args.decision_key,
            args.decision_summary,
            args.rationale,
            status=args.status,
            user_name=args.user_name,
            agent_name=args.agent_name,
        )
        print(json.dumps({"db": str(db_path), "status": "decision_recorded"}, ensure_ascii=False))
        return 0

    if args.command == "summary":
        print(summarize_history(db_path, args.task_id).as_text())
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
