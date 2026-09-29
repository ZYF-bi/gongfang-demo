"""项目公开分享：所有者开启/关闭分享，任何人可通过随机链接只读查看。"""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.projects import Projects
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/share", tags=["share"])


class ToggleBody(BaseModel):
    project_id: int
    enable: bool


class ToggleResult(BaseModel):
    share_token: Optional[str] = None


class SharedPage(BaseModel):
    name: str
    html: str
    revision: int


@router.post("/toggle", response_model=ToggleResult)
async def toggle(body: ToggleBody, current_user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = (
        await db.execute(select(Projects).where(Projects.id == body.project_id, Projects.user_id == str(current_user.id)))
    ).scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if body.enable:
        if not project.share_token:
            project.share_token = secrets.token_urlsafe(16)
    else:
        project.share_token = None
    token = project.share_token
    await db.commit()
    return ToggleResult(share_token=token)


@router.get("/page/{token}", response_model=SharedPage)
async def page(token: str, db: AsyncSession = Depends(get_db)):
    if not token or len(token) < 16 or len(token) > 64:
        raise HTTPException(status_code=404, detail="分享链接无效或已关闭")
    project = (await db.execute(select(Projects).where(Projects.share_token == token))).scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="分享链接无效或已关闭")
    return SharedPage(name=project.name, html=project.html, revision=project.revision)
