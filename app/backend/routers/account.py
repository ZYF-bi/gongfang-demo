"""账号数据管理：注销（删除当前用户的全部项目、版本；邮箱账号同时删除账号本身）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.email_accounts import Email_accounts
from models.project_versions import Project_versions
from models.projects import Projects
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/account", tags=["account"])


class DeleteBody(BaseModel):
    confirm: str


@router.post("/delete")
async def delete_account(body: DeleteBody, current_user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.confirm != "注销":
        raise HTTPException(status_code=400, detail="请输入“注销”确认")
    uid = str(current_user.id)
    versions = await db.execute(delete(Project_versions).where(Project_versions.user_id == uid))
    projects = await db.execute(delete(Projects).where(Projects.user_id == uid))
    account_deleted = False
    if uid.startswith("email-"):
        try:
            account_id = int(uid.split("-", 1)[1])
        except ValueError:
            account_id = None
        if account_id is not None:
            acc = (await db.execute(select(Email_accounts).where(Email_accounts.id == account_id))).scalars().first()
            if acc:
                await db.delete(acc)
                account_deleted = True
    await db.commit()
    return {"projects": projects.rowcount or 0, "versions": versions.rowcount or 0, "account_deleted": account_deleted}
