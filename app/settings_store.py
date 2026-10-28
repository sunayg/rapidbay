"""Saves settings edited in the browser and applies them to the `settings` module.

Precedence is saved > environment > built-in default. The file holds wire
values (see settings_schema) so they are validated again on every load.
"""

import json
import logging
import os
import shutil
import types
from typing import Any

from settings_schema import CATEGORIES, FIELDS, Field, ValidationError, coerce, to_wire

log = logging.getLogger("rapidbay.settings")

SETTINGS_FILENAME = "settings.json"
# (host setting, paired API key setting)
HOST_KEY_PAIRS = (("JACKETT_HOST", "JACKETT_API_KEY"), ("PROWLARR_HOST", "PROWLARR_API_KEY"))


class SettingsValidationError(Exception):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("invalid settings")
        self.errors = errors


def _settings() -> types.ModuleType:
    import settings

    return settings


def settings_path() -> str:
    return os.path.join(os.path.dirname(_settings().LIBRARY_PATH), SETTINGS_FILENAME)


def _valid_wire(key: str, wire: Any) -> bool:
    field = FIELDS.get(key)
    if field is None:
        log.warning("Ignoring unknown saved setting %s", key)
        return False
    try:
        coerce(field, wire)
    except ValidationError as e:
        log.warning("Ignoring invalid saved setting %s: %s", key, e.message)
        return False
    return True


def load_saved(path: str | None = None) -> dict[str, Any]:
    path = path or settings_path()
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        values = data["values"]
        if not isinstance(values, dict):
            raise ValueError("values is not an object")
    except FileNotFoundError:
        return {}
    except Exception as e:
        log.warning("Ignoring unreadable settings file %s: %s", path, e)
        return {}
    return {k: v for k, v in values.items() if _valid_wire(k, v)}


def apply_saved(mod: types.ModuleType) -> None:
    """Startup: apply every valid saved value, including restart-needed ones."""
    for key, wire in load_saved(os.path.join(os.path.dirname(mod.LIBRARY_PATH), SETTINGS_FILENAME)).items():
        setattr(mod, key, coerce(FIELDS[key], wire))


def _write(values: dict[str, Any]) -> None:
    path = settings_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if os.path.exists(path):
        shutil.copyfile(path, path + ".bak")
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "values": values}, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _norm_host(value: Any) -> str:
    return (value or "").rstrip("/")


def save_category(category: str, wire_values: dict[str, Any]) -> list[str]:
    if category not in {c for c, _ in CATEGORIES}:
        raise KeyError(category)
    mod = _settings()
    errors: dict[str, str] = {}
    coerced: dict[str, Any] = {}
    for key, wire in wire_values.items():
        field = FIELDS.get(key)
        if field is None or field.category != category:
            errors[key] = "Unknown setting"
            continue
        if field.secret and (wire is None or wire == ""):
            continue  # blank secret means keep the current value
        try:
            coerced[key] = coerce(field, wire)
        except ValidationError as e:
            errors[key] = e.message
    if errors:
        raise SettingsValidationError(errors)
    for host_key, api_key in HOST_KEY_PAIRS:
        if host_key in coerced and api_key not in coerced and coerced[host_key] != _norm_host(getattr(mod, host_key)):
            coerced[api_key] = ""  # never send the old key to a new host
    return _commit(mod, coerced)


def _commit(mod: types.ModuleType, coerced: dict[str, Any]) -> list[str]:
    saved = load_saved()
    changed: list[str] = []
    for key, value in coerced.items():
        if value != getattr(mod, key):
            changed.append(key)
        saved[key] = to_wire(FIELDS[key], value)
    _write(saved)
    for key, value in coerced.items():
        if not FIELDS[key].restart_needed:
            setattr(mod, key, value)
    return changed


def _field(key: str) -> Field:
    return FIELDS[key]  # KeyError for unknown keys


def reset_field(key: str) -> list[str]:
    field = _field(key)
    mod = _settings()
    saved = load_saved()
    if key not in saved:
        return []
    del saved[key]
    _write(saved)
    if not field.restart_needed:
        setattr(mod, key, mod._ENV_VALUES.get(key, mod._DEFAULTS[key]))
    return [key]


def clear_field(key: str) -> list[str]:
    field = _field(key)
    if field.kind in ("str", "url") or field.secret:
        value: Any = ""
    elif field.nullable:
        value = None
    else:
        raise ValueError(f"{key} cannot be cleared")
    return _commit(_settings(), {key: value})


def describe_all() -> dict[str, Any]:
    mod = _settings()
    saved = load_saved()
    fields: list[dict[str, Any]] = []
    for key, field in FIELDS.items():
        running = getattr(mod, key)
        if key in saved:
            source = "saved"
        elif key in mod._ENV_VALUES:
            source = "env"
        else:
            source = "default"
        pending = field.restart_needed and key in saved and coerce(field, saved[key]) != running
        fields.append(
            {
                "key": key,
                "category": field.category,
                "kind": field.kind,
                "label": field.label,
                "help": field.help,
                "secret": field.secret,
                "restart_needed": field.restart_needed,
                "nullable": field.nullable,
                "min": field.min,
                "max": field.max,
                "default": None if field.secret else to_wire(field, mod._DEFAULTS[key]) if mod._DEFAULTS[key] is not None else None,
                "value": None if field.secret else (to_wire(field, running) if running is not None else None),
                "is_set": bool(running) if field.secret else None,
                "source": source,
                "pending_restart": pending,
            }
        )
    return {"categories": [{"id": c, "label": label} for c, label in CATEGORIES], "fields": fields}
