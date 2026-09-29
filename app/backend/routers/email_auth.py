"""应用内邮箱 + 密码注册登录。

签发与平台登录相同格式的 JWT，因此 /api/v1/auth/me、实体接口和生成接口都能直接识别。
"""
import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_access_token
from core.database import get_db
from dependencies.auth import get_current_user
from models.email_accounts import Email_accounts
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/email_auth", tags=["email_auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_FAILED = 5
LOCK_MINUTES = 15
PBKDF2_ROUNDS = 200_000


class RegisterBody(BaseModel):
    email: str
    password: str
    confirm_password: str


class LoginBody(BaseModel):
    email: str
    password: str


class AuthResult(BaseModel):
    token: str
    email: str


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()


def _norm_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="请输入有效邮箱")
    return email


def _check_password(pw: str) -> None:
    if not 8 <= len(pw) <= 64:
        raise HTTPException(status_code=400, detail="密码需要 8—64 个字符")
    if not (re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw)):
        raise HTTPException(status_code=400, detail="密码须包含字母和数字")


def _issue(account: Email_accounts) -> AuthResult:
    token = create_access_token(
        {"sub": f"email-{account.id}", "email": account.email, "name": account.email.split("@")[0], "role": "user"}
    )
    return AuthResult(token=token, email=account.email)


@router.post("/register", response_model=AuthResult)
async def register(body: RegisterBody, db: AsyncSession = Depends(get_db)):
    email = _norm_email(body.email)
    _check_password(body.password)
    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="两次密码不一致")
    exists = (await db.execute(select(Email_accounts).where(Email_accounts.email == email))).scalars().first()
    if exists:
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
    salt = secrets.token_hex(16)
    account = Email_accounts(email=email, password_hash=_hash(body.password, salt), salt=salt, failed_attempts=0)
    db.add(account)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logging.warning("email register failed: %s", type(exc).__name__)
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")
    return _issue(account)


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str
    confirm_password: str


@router.post("/change_password")
async def change_password(
    body: ChangePasswordBody,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not str(current_user.id).startswith("email-"):
        raise HTTPException(status_code=400, detail="平台账号请在平台账号设置中修改密码")
    try:
        account_id = int(str(current_user.id).split("-", 1)[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="账号信息无效")
    account = (await db.execute(select(Email_accounts).where(Email_accounts.id == account_id))).scalars().first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not hmac.compare_digest(_hash(body.old_password, account.salt), account.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    _check_password(body.new_password)
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="两次密码不一致")
    if body.new_password == body.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    salt = secrets.token_hex(16)
    account.salt = salt
    account.password_hash = _hash(body.new_password, salt)
    await db.commit()
    return {"ok": True}


@router.post("/login", response_model=AuthResult)
async def login(body: LoginBody, db: AsyncSession = Depends(get_db)):
    email = _norm_email(body.email)
    if not body.password or len(body.password) > 256:
        raise HTTPException(status_code=400, detail="请输入密码")
    account = (await db.execute(select(Email_accounts).where(Email_accounts.email == email))).scalars().first()
    if not account:
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    now = datetime.now(timezone.utc)
    if account.locked_until:
        try:
            until = datetime.fromisoformat(account.locked_until)
        except ValueError:
            until = None
        if until and until > now:
            minutes = max(1, int((until - now).total_seconds() // 60) + 1)
            raise HTTPException(status_code=429, detail=f"密码错误次数过多，请 {minutes} 分钟后再试")
    if not hmac.compare_digest(_hash(body.password, account.salt), account.password_hash):
        failed = (account.failed_attempts or 0) + 1
        account.failed_attempts = failed
        if failed >= MAX_FAILED:
            account.locked_until = (now + timedelta(minutes=LOCK_MINUTES)).isoformat()
            account.failed_attempts = 0
            await db.commit()
            raise HTTPException(status_code=429, detail=f"密码错误次数过多，请 {LOCK_MINUTES} 分钟后再试")
        await db.commit()
        raise HTTPException(status_code=401, detail=f"邮箱或密码错误（还可尝试 {MAX_FAILED - failed} 次）")
    account.failed_attempts = 0
    account.locked_until = None
    await db.commit()
    return _issue(account)
