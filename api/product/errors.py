"""Friendly errors with a stable machine code. Never leak platform text."""

from fastapi import HTTPException


def product_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})
