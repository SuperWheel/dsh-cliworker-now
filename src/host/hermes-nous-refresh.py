"""One bounded, same-account Nous renewal inside the verified native environment.

This module is loaded only by our fixed native-entry operation. Native OAuth
owns token exchange and atomic persistence. No resolver, pool selection, login,
anonymous identity, browser, model request or credential output is permitted.
"""
import base64
import contextlib
from datetime import datetime
import hashlib
import inspect
import json
import logging
import math
import os
from pathlib import Path
import re
import signal
import stat
import time

PORTAL = "https://portal.nousresearch.com"
INFERENCE = "https://inference-api.nousresearch.com/v1"
CLIENT = "hermes-cli"
MAX_FILE = 4 * 1024 * 1024
TOKEN_FIELDS = (
    "access_token", "refresh_token", "token_type", "scope", "client_id",
    "portal_base_url", "inference_base_url", "obtained_at", "expires_at", "expires_in",
    "agent_key", "agent_key_id", "agent_key_expires_at", "agent_key_expires_in",
    "agent_key_reused", "agent_key_obtained_at", "tls",
)
TERMINAL = {"invalid_grant", "invalid_token", "refresh_token_reused", "nous_auth_missing_refresh_token"}


class Refusal(Exception):
    def __init__(self, state="changed"):
        self.state = state


def text(value):
    return isinstance(value, str) and 0 < len(value) <= 32768 and not re.search(r"[\x00-\x20\x7f]", value)


def canonical(value, expected):
    return isinstance(value, str) and value.rstrip("/") == expected


def claims(token):
    if not text(token) or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
        raise Refusal()
    raw = token.split(".")[1]
    value = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    if not isinstance(value, dict):
        raise Refusal()
    return value


def scope_values(value):
    if isinstance(value, str):
        return re.split(r"[\s,]+", value)
    if isinstance(value, list):
        return [part for item in value for part in scope_values(item)]
    return []


def identity(state):
    if not isinstance(state, dict) or state.get("auth_method") == "anonymous" or state.get("account_tier") == "anonymous":
        raise Refusal()
    token = claims(state.get("access_token"))
    if token.get("account_tier") == "anonymous" or any(not text(token.get(key)) for key in ("sub", "org_id", "iss")):
        raise Refusal()
    client = token.get("client_id", "")
    if client is None:
        client = ""
    if client != "" and not text(client):
        raise Refusal()
    expiry = token.get("exp")
    if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or not math.isfinite(expiry):
        raise Refusal()
    if "inference:invoke" not in (scope_values(state.get("scope")) + scope_values(token.get("scope")) + scope_values(token.get("scp"))):
        raise Refusal()
    if not canonical(state.get("portal_base_url"), PORTAL) or not canonical(state.get("inference_base_url"), INFERENCE):
        raise Refusal()
    native_client = state.get("client_id") or CLIENT
    if not text(native_client):
        raise Refusal()
    key = ["hermes-nous-v1", token["sub"], token["org_id"], token["iss"], client, PORTAL, INFERENCE]
    digest = hashlib.sha256(json.dumps(key, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    return digest, native_client, float(expiry)


def regular_file(path, *, optional=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if optional:
            return False
        raise Refusal("unavailable")
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
        raise Refusal()
    return True


def read_json(path):
    value = json.loads(read_private_text(path))
    if not isinstance(value, dict):
        raise Refusal()
    return value


def read_private_text(path):
    regular_file(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        current = path.lstat()
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or opened.st_size > MAX_FILE
                or stat.S_ISLNK(current.st_mode) or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)):
            raise Refusal()
        data = stream.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise Refusal()
        return data.decode("utf-8-sig")


def check_configuration(home):
    # The native entry has already loaded only this home's dotenv. Do not import
    # main/config resolution, which can consult profiles or external sources.
    import hermes_yaml as yaml
    config_path = home / "config.yaml"
    config = yaml.safe_load(read_private_text(config_path))
    if not isinstance(config, dict) or not isinstance(config.get("model"), dict):
        raise Refusal()
    if (config.get("auth") or {}).get("adopt_external_logins") is not False:
        raise Refusal()
    model = config["model"]
    if model.get("provider") != "nous" or (config.get("providers") or {}).get("nous", {}).get("enabled") is False:
        raise Refusal()
    if model.get("api_key") or model.get("extra_headers") or any(os.environ.get(k) for k in ("NOUS_API_KEY", "CUSTOM_API_KEY")):
        raise Refusal()
    if any(re.fullmatch(r"NOUS_API_KEY_\d+", k) and v for k, v in os.environ.items()):
        raise Refusal()
    for value in (model.get("base_url"), os.environ.get("NOUS_INFERENCE_BASE_URL"), os.environ.get("CUSTOM_BASE_URL")):
        if value and not canonical(value, INFERENCE):
            raise Refusal()
    for name in ("NOUS_PORTAL_BASE_URL", "HERMES_PORTAL_BASE_URL"):
        if os.environ.get(name) and not canonical(os.environ[name], PORTAL):
            raise Refusal()
    if model.get("api_mode") not in (None, "chat_completions", "anthropic_messages"):
        raise Refusal()
    if (config.get("nous") or {}).get("anthropic_wire", "chat") not in ("chat", "native", "auto"):
        raise Refusal()


def check_available(row):
    if row.get("disabled") is True or row.get("status") == "exhausted" or row.get("last_status") == "dead":
        raise Refusal("unavailable")
    if row.get("last_status") == "exhausted":
        until = row.get("last_error_reset_at")
        if not isinstance(until, (int, float)) or isinstance(until, bool) or not math.isfinite(until) or until <= 0 or until > time.time():
            raise Refusal("unavailable")
    cooldowns = row.get("model_cooldowns", {})
    if not isinstance(cooldowns, dict) or any(
        isinstance(until, (int, float)) and not isinstance(until, bool) and until > time.time()
        for until in cooldowns.values()
    ):
        raise Refusal("unavailable")


def checked_pool(store, state, expected):
    if store.get("active_provider") != "nous" or state.get("agent_key") != state.get("access_token"):
        raise Refusal()
    if state.get("last_auth_error", {}).get("relogin_required") is True and not (state.get("access_token") or state.get("refresh_token")):
        raise Refusal("relogin")
    check_available(state)
    rows = store.get("credential_pool", {}).get("nous")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 8:
        raise Refusal()
    for row in rows:
        if not isinstance(row, dict) or row.get("auth_type") != "oauth" or row.get("source") not in ("device_code", "manual:device_code"):
            raise Refusal()
        if row.get("access_token") != state.get("access_token") or row.get("agent_key") != state.get("agent_key"):
            raise Refusal()
        if row.get("refresh_token") not in (None, state.get("refresh_token")):
            raise Refusal()
        for field, endpoint in (("portal_base_url", PORTAL), ("inference_base_url", INFERENCE), ("base_url", INFERENCE)):
            if row.get(field) and not canonical(row[field], endpoint):
                raise Refusal()
        if (row.get("client_id") or CLIENT) != expected[1]:
            raise Refusal()
        check_available(row)
    return rows


def checked_shared(shared, state, expected):
    if shared.get("_schema") != 1:
        raise Refusal()
    # Hermes 0.23.1 auth_nous._merge_shared_nous_oauth_state prefers the
    # renewal beside another identity when its JWT subject is this account's.
    # The nested shape has no _schema. Keep our full principal/client/route
    # checks after selection, including when verifying a native mirror write.
    renewed = shared.get("renewal")
    if isinstance(renewed, dict) and renewed.get("auth_method") != "anonymous":
        try:
            subject = claims(renewed.get("access_token")).get("sub")
        except (Refusal, ValueError):
            subject = None
        if subject == claims(state.get("access_token")).get("sub"):
            shared = renewed
    if not text(shared.get("refresh_token")):
        raise Refusal()
    found = identity(shared)
    if found[:2] != expected[:2]:
        raise Refusal()
    return shared


def oauth_timestamp(value):
    # Native credential_pool_timestamps accepts epoch seconds, milliseconds,
    # numeric strings and ISO-8601 for OAuth issue/expiry metadata.
    if isinstance(value, bool) or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        try:
            numeric = datetime.fromisoformat(value).timestamp()
        except (TypeError, ValueError, OverflowError):
            return None
    if not math.isfinite(numeric) or numeric <= 0:
        return None
    return numeric / 1000.0 if numeric > 1_000_000_000_000 else numeric


def state_order(a, b):
    # Reviewed Hermes 0.23.1 auth_oauth_grants.oauth_pair_order: issue time
    # wins even for shorter-lived rotations. Equal iat falls to the local
    # issue stamp, never expiry; expiry orders states without comparable issue
    # stamps. Keep this pure so no broader native resolver can run here.
    def stamps(state):
        token = claims(state.get("access_token"))
        def first(*values):
            return next((stamp for stamp in map(oauth_timestamp, values) if stamp is not None), None)
        return (first(token.get("iat")), first(state.get("last_refresh"), state.get("obtained_at")),
                first(token.get("exp"), state.get("expires_at_ms"), state.get("expires_at")))
    def sign(x, y):
        return None if x is None or y is None else (x > y) - (x < y)
    (ia, la, ea), (ib, lb, eb) = stamps(a), stamps(b)
    if ia is not None and ib is not None:
        return sign(ia, ib) or sign(la, lb) or 0
    issued = sign(ia or la, ib or lb)
    if issued is not None:
        return issued
    expiry = sign(ea, eb)
    if expiry:
        return expiry
    a_any, b_any = any(v is not None for v in (ia, la, ea)), any(v is not None for v in (ib, lb, eb))
    if not a_any and not b_any:
        return None
    return 0 if a_any == b_any else (1 if a_any else -1)


def shared_write_options(write):
    # Hermes 0.23.1 (3b4215785882), auth_nous.py, requires renewal=True:
    # a refresh must not replace a different shared identity as a new login.
    # Earlier reviewed versions take only state. Bind BEFORE spending a grant
    # or repairing a mirror; never retry a write on TypeError from its body.
    try:
        signature = inspect.signature(write)
        if tuple(signature.parameters) not in (("state",), ("state", "renewal")):
            raise Refusal("unsupported")
        options = {"renewal": True} if "renewal" in signature.parameters else {}
        signature.bind({}, **options)
        return options
    except (TypeError, ValueError):
        raise Refusal("unsupported") from None


def _run(home, expected_digest, cancelled):
    if not re.fullmatch(r"[a-f0-9]{64}", expected_digest or ""):
        raise Refusal("unsupported")
    from hermes_cli import auth
    from hermes_constants import get_default_hermes_root
    required = ("_provider_state_transaction", "_auth_file_path", "_nous_shared_store_path", "_nous_shared_store_lock",
                "_save_provider_state_to_source", "_write_shared_nous_state", "_select_nous_invoke_jwt", "refresh_nous_oauth_from_state")
    if any(not callable(getattr(auth, key, None)) for key in required):
        raise Refusal("unsupported")
    if "on_state_update" not in inspect.signature(auth.refresh_nous_oauth_from_state).parameters:
        raise Refusal("unsupported")
    mirror_options = shared_write_options(auth._write_shared_nous_state)
    home = Path(home)
    if home != home.resolve() or not home.is_dir() or get_default_hermes_root().resolve() != home:
        raise Refusal()
    auth_path = home / "auth.json"
    shared_path = auth._nous_shared_store_path()
    if auth._auth_file_path().resolve() != auth_path or shared_path.parent != home / "shared" or shared_path.resolve() != shared_path:
        raise Refusal()
    if (home / "shared").exists() and not (home / "shared").is_dir():
        raise Refusal()
    check_configuration(home)
    raw_ttl = os.environ.get("HERMES_NOUS_MIN_KEY_TTL_SECONDS", "120")
    if not re.fullmatch(r"\d+", raw_ttl) or len(raw_ttl) > 9:
        raise Refusal()
    ttl = max(120, int(raw_ttl))
    # Native cross-process ordering: auth first, shared second. No profile/global
    # fallback or shared merge is allowed without the exact selected identity.
    # Confirm the local provider exists before the native transaction can even
    # consult a global fallback. Re-read under its lock to bind the snapshot.
    if not isinstance(read_json(auth_path).get("providers", {}).get("nous"), dict):
        raise Refusal()
    with auth._provider_state_transaction("nous", timeout_seconds=1.0) as (store, state, source):
        snapshot = read_json(auth_path)
        if source is None or Path(source).resolve() != auth_path or not isinstance(store.get("providers", {}).get("nous"), dict):
            raise Refusal()
        if snapshot.get("providers", {}).get("nous") != state or snapshot.get("credential_pool") != store.get("credential_pool"):
            raise Refusal()
        check_configuration(home)
        expected = identity(state)
        if expected[0] != expected_digest:
            raise Refusal()
        rows = checked_pool(store, state, expected)
        if cancelled[0]:
            raise Refusal("unavailable")
        with auth._nous_shared_store_lock(timeout_seconds=1.0):
            shared = read_json(shared_path) if regular_file(shared_path, optional=True) else None
            if shared is not None:
                shared = checked_shared(shared, state, expected)
                different_pair = (shared.get("access_token"), shared.get("refresh_token")) != (state.get("access_token"), state.get("refresh_token"))
                order = state_order(shared, state)
                if different_pair and order not in (-1, 1):
                    raise Refusal()
            else:
                order, different_pair = None, False

            def persist(update, _reason=None):
                nonlocal state
                merged = {**state, **{key: update[key] for key in TOKEN_FIELDS if key in update}}
                if identity(merged)[:2] != expected[:2]:
                    raise Refusal()
                # Select only this already identity-checked invoke JWT. This has
                # no network/I/O and keeps pool aliases consistent even if the
                # pure refresher's later validation fails after token rotation.
                auth._select_nous_invoke_jwt(merged)
                if merged.get("agent_key") != merged.get("access_token"):
                    raise Refusal("unsupported")
                for row in rows:
                    for key in TOKEN_FIELDS:
                        if key in merged:
                            row[key] = merged[key]
                auth._save_provider_state_to_source(store, "nous", merged, source)
                state = merged
                # Native mirror is best-effort, so verify the saved pair before
                # reporting ready. No outside-home store is ever touched.
                auth._write_shared_nous_state(state, **mirror_options)
                saved = checked_shared(read_json(shared_path), state, expected)
                if any(saved.get(k) != state.get(k) for k in ("access_token", "refresh_token")):
                    raise Refusal("unavailable")

            # A newer peer rotation for this exact principal/client/route may
            # be adopted. Tied issue stamps are not a proven chain.
            if different_pair and order == 1:
                persist(shared)
            elif different_pair:
                # The selected store is provably newer. Repair this same-home,
                # same-principal mirror before a native resolver can adopt its
                # older single-use refresh token back into the selected store.
                persist(state)
            current = identity(state)
            if current[2] > time.time() + ttl:
                return "ready"
            if not text(state.get("refresh_token")):
                raise Refusal("relogin")
            if cancelled[0]:
                raise Refusal("unavailable")
            refreshed = auth.refresh_nous_oauth_from_state(
                state, timeout_seconds=4.0, force_refresh=True, on_state_update=persist)
            persist(refreshed)
            if identity(state)[2] <= time.time() + 120:
                raise Refusal("unavailable")
            return "unavailable" if cancelled[0] else "ready"


def refresh_selected_nous(home, expected_digest):
    """Fixed safe receipt only. Exceptions and logs never cross the boundary."""
    cancelled = [False]
    handlers = {}
    def on_cancel(_signal, _frame):
        # Do not interrupt a successful single-use token exchange before its
        # callback saves the rotation. Host must also await this bounded child
        # on Windows, where Job termination cannot be deferred by Python.
        cancelled[0] = True
    for number in (signal.SIGTERM, signal.SIGINT):
        handlers[number] = signal.signal(number, on_cancel)
    old_disable = logging.root.manager.disable
    try:
        with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            logging.disable(logging.CRITICAL)
            try:
                return _run(home, expected_digest, cancelled)
            except Refusal as error:
                return error.state
            except Exception as error:
                if getattr(error, "code", None) in TERMINAL and bool(getattr(error, "relogin_required", False)):
                    return "relogin"
                return "unavailable"
    finally:
        logging.disable(old_disable)
        for number, handler in handlers.items():
            signal.signal(number, handler)
