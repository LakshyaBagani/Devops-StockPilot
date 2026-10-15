"""Build identity: the UI footer and the CI deploy smoke loop read /api/version."""

from fastapi import APIRouter

from app.config import settings
from app.schemas import VersionOut

router = APIRouter(tags=["meta"])


@router.get("/version")
async def version() -> VersionOut:
    """App version, full commit SHA and build time of the running image."""
    # The SHA is returned verbatim (40 characters in CI); the smoke loop compares it to $GITHUB_SHA.
    return VersionOut(
        version=settings.app_version, git_sha=settings.git_sha, build_time=settings.build_time
    )
