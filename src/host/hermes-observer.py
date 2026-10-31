"""Explicit observer of this process's official Hermes request lifecycle.

Only the public PluginContext registration API is used. Safe mode stays enabled;
no plugin discovery, model call, request mutation, or private Agent access occurs.
"""
import json
import os
import re
import stat
import threading
from pathlib import Path

# Current official FailoverReason values plus the explicit invalid-response hook.
# No provider message, URL, request body or credential is copied into this rail.
SAFE_ERROR_REASONS = frozenset((
    "auth", "auth_permanent", "billing", "rate_limit", "upstream_rate_limit",
    "upstream_blocked", "overloaded", "server_error", "timeout", "ssl_cert_verification",
    "context_overflow", "payload_too_large", "image_too_large", "image_corrupt", "model_not_found",
    "provider_policy_blocked", "content_policy_blocked", "model_entitlement", "incomplete_response",
    "format_error", "role_alternation", "invalid_encrypted_content", "multimodal_tool_content_unsupported",
    "reasoning_mandatory", "thinking_signature", "long_context_tier", "oauth_long_context_beta_forbidden",
    "llama_cpp_grammar_pattern", "unknown", "invalid_response",
))


def _complete_numeric_input(value):
    """Bound a local estimate; reject public-hook truncation/redaction markers.

    This walk never serializes the input. Text stays in this child process and
    only the resulting numeric estimates may enter the observation rail.
    """
    pending, nodes, chars = [(value, 0)], 0, 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > 50000 or depth > 16:
            return False
        if isinstance(item, str):
            chars += len(item)
            if (chars > 4 * 1024 * 1024 or item == "<redacted>" or
                    re.search(r"\.\.\.\[truncated \d+ chars\]|<[^<>]+ depth limit>", item)):
                return False
        elif isinstance(item, dict):
            if ("_truncated" in item or "_truncated_items" in item or
                    len(item) * 2 + len(pending) + nodes > 50000):
                return False
            pending.extend((part, depth + 1) for pair in item.items() for part in pair)
        elif isinstance(item, list):
            if len(item) + len(pending) + nodes > 50000:
                return False
            pending.extend((part, depth + 1) for part in item)
        elif item is not None and not isinstance(item, (bool, int, float)):
            return False
    return True


def request_context_breakdown(payload):
    """Estimate verified Chat Completions inputs with Hermes's own functions.

    Other wire shapes need their own accounting projection. In particular this
    does not treat Responses items or Anthropic blocks as OpenAI messages.
    """
    if payload.get("api_mode") != "chat_completions" or payload.get("provider") == "moa":
        return None
    try:
        from agent.model_metadata import estimate_messages_tokens_rough, estimate_request_tokens_rough
        counts = {}
        messages = payload.get("request_messages")
        if (isinstance(messages, list) and _complete_numeric_input(messages) and
                all(isinstance(item, dict) and item.get("role") in
                    ("system", "developer", "user", "assistant", "tool", "function") for item in messages)):
            system = [item for item in messages if item["role"] in ("system", "developer")]
            conversation = [item for item in messages if item["role"] not in ("system", "developer")]
            counts["messageTokens"] = estimate_messages_tokens_rough(conversation)
            prompt = payload.get("system_prompt")
            # The public hook repeats messages[0].content as system_prompt on
            # this wire. Count that input once, not once per hook field.
            first_system = messages[0] if messages and messages[0].get("role") == "system" else None
            if prompt is None or (first_system is not None and prompt == first_system.get("content")):
                counts["systemTokens"] = estimate_messages_tokens_rough(system)
        request = payload.get("request")
        body = request.get("body") if isinstance(request, dict) else None
        # Absence is unknown. An explicit complete [] is evidence of zero tools.
        if (isinstance(request, dict) and not any(key in request for key in ("_truncated", "_truncated_items")) and
                isinstance(body, dict) and not any(key in body for key in ("_truncated", "_truncated_items")) and
                isinstance(body.get("tools"), list) and _complete_numeric_input(body["tools"]) and
                all(isinstance(tool, dict) and tool.get("type") == "function" and
                    isinstance(tool.get("function"), dict) and isinstance(tool["function"].get("name"), str)
                    for tool in body["tools"])):
            counts["toolTokens"] = estimate_request_tokens_rough([], tools=body["tools"])
        counts = {key: value for key, value in counts.items()
                  if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991}
        return {**counts, "estimated": True, "basis": "hermes-native-request-estimate"} if counts else None
    except Exception:
        # An optional display estimate cannot fail or retry a model request.
        return None


def install_observer():
    directory = os.environ.get("CLIWORKER_HERMES_OBSERVER_DIR", "")
    nonce = os.environ.get("CLIWORKER_HERMES_OBSERVER_NONCE", "")
    if not directory or not nonce or os.environ.get("HERMES_SAFE_MODE") != "1":
        return lambda: None
    root = Path(directory)
    if not root.is_absolute() or root.resolve() != root or len(nonce) != 64:
        return lambda: None
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or (os.name != "nt" and info.st_mode & 0o077):
        return lambda: None
    from hermes_cli.plugins import PluginContext, PluginManifest, get_plugin_manager
    target = root / "events.jsonl"
    fd = os.open(target, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size:
        os.close(fd)
        return lambda: None
    lock, sequence, closed = threading.Lock(), 0, False
    handles = []

    def write(record):
        nonlocal sequence
        with lock:
            if closed or os.fstat(fd).st_size > 16 * 1024 * 1024:
                return
            sequence += 1
            record = {"v": 1, "nonce": nonce, "seq": sequence, **record}
            encoded = (json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
            if len(encoded) <= 128 * 1024:
                os.write(fd, encoded)

    def identity(payload, terminal=False):
        # This file is written once, before the sole /v1/runs submission. A hook
        # cannot claim another session merely by running in this Python process.
        path = root / "identity.json"
        control_fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(control_fd, encoding="utf-8") as stream:
            meta = os.fstat(stream.fileno())
            if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1 or meta.st_size > 4096:
                return False
            binding = json.load(stream)
        return (binding.get("nonce") == nonce and payload.get("platform") == "api_server"
                and payload.get("session_id") == binding.get("sessionId")
                and (terminal or payload.get("provider") == binding.get("provider"))
                and payload.get("model") == binding.get("model"))

    def observe(_event_phase, **payload):
        try:
            if not identity(payload):
                return
            record = {"phase": _event_phase}
            for key in ("session_id", "task_id", "turn_id", "api_request_id", "model", "provider", "api_mode"):
                value = payload.get(key)
                if not isinstance(value, str) or not value or len(value) > 500:
                    write({"phase": "invalid"})
                    return
                record[key] = value
            for key in ("api_call_count", "started_at", "ended_at", "context_length", "retry_count"):
                value = payload.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
                    record[key] = value
            if _event_phase == "request":
                breakdown = request_context_breakdown(payload)
                if breakdown is not None:
                    record["context_breakdown"] = breakdown
            if _event_phase == "error":
                for key in ("status_code", "max_retries"):
                    value = payload.get(key)
                    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991:
                        if key != "status_code" or 100 <= value <= 599:
                            record[key] = value
                if isinstance(payload.get("retryable"), bool):
                    record["retryable"] = payload["retryable"]
                if isinstance(payload.get("reason"), str) and payload["reason"] in SAFE_ERROR_REASONS:
                    record["reason"] = payload["reason"]
            if _event_phase == "response":
                usage = payload.get("usage")
                if isinstance(usage, dict):
                    record["usage"] = {key: usage[key] for key in (
                        "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
                        "reasoning_tokens", "prompt_tokens", "total_tokens")
                        if isinstance(usage.get(key), int) and not isinstance(usage[key], bool) and 0 <= usage[key] <= 9007199254740991}
                # The public hook labels this canonical normalized data; absence
                # of a raw provider bucket cannot be recovered from its defaults.
                record["usage_basis"] = "hermes-canonical"
                record["moa"] = bool(payload.get("moa_references"))
            write(record)
        except Exception:
            # Optional observer failure never retries or fails a model request.
            try:
                write({"phase": "invalid"})
            except Exception:
                pass
            return

    def turn_end(**payload):
        try:
            if identity(payload, terminal=True):
                write({"phase": "turn_end", **{key: payload.get(key) for key in
                      ("session_id", "task_id", "turn_id", "model", "completed", "failed", "interrupted")}})
        except Exception:
            pass

    context = PluginContext(PluginManifest(name="cliworker-observer", version="0.8.5", source="user"), get_plugin_manager())
    try:
        for hook, phase in (("pre_api_request", "request"), ("post_api_request", "response"), ("api_request_error", "error")):
            handles.append(context.register_hook(hook, lambda _phase=phase, **payload: observe(_phase, **payload)))
        handles.append(context.register_hook("on_session_end", turn_end))
        write({"phase": "ready", "hooks": ["pre_api_request", "post_api_request", "api_request_error", "on_session_end"]})
    except Exception:
        for handle in handles:
            handle.dispose()
        os.close(fd)
        raise

    def dispose():
        nonlocal closed
        for handle in handles:
            handle.dispose()
        with lock:
            if not closed:
                closed = True
                os.close(fd)
    return dispose
