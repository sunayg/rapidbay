"""HTTP API behind the settings page."""

# pyright: reportUnusedFunction=false

from typing import Any, Callable

import settings
import settings_store
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from settings_schema import FIELDS


class SaveRequest(BaseModel):
    values: dict[str, Any]


def _respond(changed: list[str]) -> JSONResponse:
    response = JSONResponse(settings_store.describe_all())
    if "PASSWORD" in changed and settings.PASSWORD:
        # Same cookie login() sets, so the person who changed it stays logged in.
        response.set_cookie(key="password", value=settings.PASSWORD)
    return response


def build_router(authorize: Callable[..., None]) -> APIRouter:
    router = APIRouter(dependencies=[Depends(authorize)])

    @router.get("/api/settings")
    def get_settings() -> dict[str, Any]:
        return settings_store.describe_all()

    @router.put("/api/settings/{category}")
    def save_settings(category: str, request: SaveRequest) -> JSONResponse:
        try:
            changed = settings_store.save_category(category, request.values)
        except KeyError as e:
            raise HTTPException(status_code=404) from e
        except settings_store.SettingsValidationError as e:
            return JSONResponse({"errors": e.errors}, status_code=422)
        return _respond(changed)

    @router.post("/api/settings/{key}/reset")
    def reset_setting(key: str) -> JSONResponse:
        if key not in FIELDS:
            raise HTTPException(status_code=404)
        return _respond(settings_store.reset_field(key))

    @router.post("/api/settings/{key}/clear")
    def clear_setting(key: str) -> JSONResponse:
        if key not in FIELDS:
            raise HTTPException(status_code=404)
        try:
            changed = settings_store.clear_field(key)
        except ValueError:
            return JSONResponse({"errors": {key: "This setting cannot be cleared"}}, status_code=422)
        return _respond(changed)

    return router
