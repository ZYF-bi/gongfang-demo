"""email_accounts 表只供 routers/email_auth.py 内部使用。

自动生成的公开增删改查接口会暴露密码哈希，这里故意不注册任何路由。
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/entities/email_accounts", tags=["email_accounts"])
