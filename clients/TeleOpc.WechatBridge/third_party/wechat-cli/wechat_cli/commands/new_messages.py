"""Tele-OPC incremental message query with direction metadata and durable deduplication."""

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime

import click

from ..core.config import STATE_DIR
from ..core.contacts import get_contact_names, get_self_username
from ..core.messages import (
    _format_message_text,
    _iter_table_contexts,
    _load_name2id_maps,
    _query_messages,
    decompress_content,
    format_msg_type,
    resolve_chat_context,
)
from ..output.formatter import output

STATE_FILE = os.path.join(STATE_DIR, "last_check.json")
MAX_SEEN = 2000


def _load_state():
    if not os.path.exists(STATE_FILE):
        return {"timestamps": {}, "seen": []}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            value = json.load(f)
        if isinstance(value, dict) and "timestamps" in value:
            return {"timestamps": value.get("timestamps", {}), "seen": value.get("seen", [])}
        # Upgrade the upstream timestamp-only state format.
        if isinstance(value, dict):
            return {"timestamps": value, "seen": []}
    except (json.JSONDecodeError, OSError):
        pass
    return {"timestamps": {}, "seen": []}


def _save_state(timestamps, seen):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump({"timestamps": timestamps, "seen": list(seen)[-MAX_SEEN:]}, f, ensure_ascii=False)


def _session_rows(app):
    path = app.cache.get(os.path.join("session", "session.db"))
    if not path:
        raise RuntimeError("无法解密 session.db")
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute("""
            SELECT username, unread_count, last_timestamp
            FROM SessionTable
            WHERE last_timestamp > 0
            ORDER BY last_timestamp DESC
        """).fetchall()


def _collect_chat_messages(app, username, display, is_group, start_ts, candidate_limit, self_username, names):
    ctx = resolve_chat_context(username, app.msg_db_keys, app.cache, app.decrypted_dir)
    if not ctx or not ctx.get("db_path"):
        return []
    collected = []
    for table_ctx in _iter_table_contexts(ctx):
        with closing(sqlite3.connect(table_ctx["db_path"])) as conn:
            id_to_username = _load_name2id_maps(conn)
            rows = _query_messages(
                conn, table_ctx["table_name"], start_ts=start_ts,
                limit=max(candidate_limit, 20), offset=0,
            )
            for row in rows:
                local_id, local_type, create_time, real_sender_id, content, ct = row
                content = decompress_content(content, ct)
                if content is None:
                    continue
                sender_from_content, text = _format_message_text(
                    local_id, local_type, content, is_group, username, display,
                    names, app.display_name_fn, create_time_ts=create_time,
                )
                sender_username = id_to_username.get(real_sender_id, "") or sender_from_content or ""
                if sender_username == self_username:
                    direction = "outbound"
                elif sender_username == username or (is_group and sender_username):
                    direction = "inbound"
                else:
                    direction = "unknown"
                message_id = f"{table_ctx['table_name']}:{local_id}:{create_time}"
                collected.append({
                    "chat": display,
                    "username": username,
                    "is_group": is_group,
                    "last_message": str(text or ""),
                    "msg_type": format_msg_type(local_type),
                    "sender_username": sender_username,
                    "direction": direction,
                    "message_id": message_id,
                    "time": datetime.fromtimestamp(create_time).strftime("%H:%M:%S"),
                    "timestamp": create_time,
                })
    collected.sort(key=lambda x: (x["timestamp"], x["message_id"]))
    return collected


@click.command("new-messages")
@click.option("--format", "fmt", default="json", type=click.Choice(["json", "text"]))
@click.pass_context
def new_messages(ctx, fmt):
    """Return every new inbound/outbound message since the previous call."""
    app = ctx.obj
    names = get_contact_names(app.cache, app.decrypted_dir)
    self_username = get_self_username(app.db_dir, app.cache, app.decrypted_dir) or ""
    rows = _session_rows(app)
    state = _load_state()
    timestamps = state["timestamps"]
    seen_order = list(state["seen"])
    seen = set(seen_order)
    first_call = not timestamps
    result = []
    current_timestamps = dict(timestamps)

    for username, unread, last_ts in rows:
        previous = int(timestamps.get(username, 0) or 0)
        current_timestamps[username] = last_ts
        if first_call:
            if not unread or unread <= 0:
                continue
            start_ts = max(0, last_ts - 86400)
            limit = max(int(unread) + 4, 20)
        else:
            if last_ts <= previous:
                continue
            start_ts = max(0, previous - 1)
            limit = 200
        display = names.get(username, username)
        is_group = "@chatroom" in username
        try:
            messages = _collect_chat_messages(app, username, display, is_group, start_ts, limit, self_username, names)
        except Exception:
            continue
        if first_call:
            messages = messages[-max(int(unread), 1):]
        for message in messages:
            mid = message["message_id"]
            if mid in seen:
                continue
            # Unknown direction is accepted only when WeChat itself reports unread messages.
            if message["direction"] == "unknown" and unread and unread > 0:
                message["direction"] = "inbound"
            result.append(message)
            seen.add(mid)
            seen_order.append(mid)

    _save_state(current_timestamps, seen_order[-MAX_SEEN:])
    result.sort(key=lambda x: (x["timestamp"], x["message_id"]))
    payload = {"first_call": first_call, "new_count": len(result), "messages": result}
    if fmt == "json":
        output(payload, "json")
    else:
        lines = [f"[{m['time']}] {m['chat']} ({m['direction']}): {m['last_message']}" for m in result]
        output("\n".join(lines) if lines else "无新消息", "text")
