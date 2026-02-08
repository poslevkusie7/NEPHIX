import os
import uuid
from contextlib import contextmanager
from typing import Any, Dict, Iterable, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json


def get_database_url() -> Optional[str]:
    return os.getenv("DATABASE_URL")


@contextmanager
def get_conn():
    db_url = get_database_url()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set.")
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        yield conn


def ensure_schema() -> None:
    ddl = """
    CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email text UNIQUE NOT NULL,
        name text,
        picture_url text,
        created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS assignments (
        id uuid PRIMARY KEY,
        task_type text NOT NULL,
        params jsonb NOT NULL,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS submissions (
        id uuid PRIMARY KEY,
        assignment_id uuid REFERENCES assignments(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        state jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (assignment_id, user_id)
    );
    """
    with get_conn() as conn:
        conn.execute(ddl)
        conn.commit()


def get_or_create_user(email: str, name: Optional[str], picture_url: Optional[str]) -> Dict[str, Any]:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM users WHERE email = %s",
            (email,),
        ).fetchone()
        if existing:
            return existing

        user_id = uuid.uuid4()
        conn.execute(
            """
            INSERT INTO users (id, email, name, picture_url)
            VALUES (%s, %s, %s, %s)
            """,
            (user_id, email, name, picture_url),
        )
        conn.commit()
        return conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()


def create_assignment(
    task_type: str,
    params: Dict[str, Any],
    created_by: Optional[str],
    assignment_id: Optional[str] = None,
) -> Dict[str, Any]:
    assignment_uuid = uuid.UUID(assignment_id) if assignment_id else uuid.uuid4()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO assignments (id, task_type, params, created_by)
            VALUES (%s, %s, %s, %s)
            """,
            (assignment_uuid, task_type, Json(params), created_by),
        )
        conn.commit()
        return conn.execute("SELECT * FROM assignments WHERE id = %s", (assignment_uuid,)).fetchone()


def get_assignment(assignment_id: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM assignments WHERE id = %s",
            (assignment_id,),
        ).fetchone()


def list_submissions_for_user(user_id: str) -> Iterable[Dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT s.id, s.assignment_id, s.state, s.updated_at,
                   a.task_type, a.params
            FROM submissions s
            JOIN assignments a ON a.id = s.assignment_id
            WHERE s.user_id = %s
            ORDER BY s.updated_at DESC
            """,
            (user_id,),
        ).fetchall()


def get_submission(submission_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        if user_id:
            return conn.execute(
                "SELECT * FROM submissions WHERE id = %s AND user_id = %s",
                (submission_id, user_id),
            ).fetchone()
        return conn.execute(
            "SELECT * FROM submissions WHERE id = %s",
            (submission_id,),
        ).fetchone()


def get_submission_for_assignment_user(assignment_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT * FROM submissions
            WHERE assignment_id = %s AND user_id = %s
            """,
            (assignment_id, user_id),
        ).fetchone()


def create_submission(
    assignment_id: str,
    user_id: str,
    state: Dict[str, Any],
    submission_id: Optional[str] = None,
) -> Dict[str, Any]:
    submission_uuid = uuid.UUID(submission_id) if submission_id else uuid.uuid4()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO submissions (id, assignment_id, user_id, state)
            VALUES (%s, %s, %s, %s)
            """,
            (submission_uuid, assignment_id, user_id, Json(state)),
        )
        conn.commit()
        return conn.execute("SELECT * FROM submissions WHERE id = %s", (submission_uuid,)).fetchone()


def update_submission_state(submission_id: str, state: Dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE submissions
            SET state = %s, updated_at = now()
            WHERE id = %s
            """,
            (Json(state), submission_id),
        )
        conn.commit()


def delete_submission(submission_id: str, user_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM submissions WHERE id = %s AND user_id = %s",
            (submission_id, user_id),
        )
        conn.commit()
