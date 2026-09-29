"""generation_logs 仅供服务端配额统计使用，不开放公开增删改查（防止用户删除记录绕过配额）。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/entities/generation_logs", tags=["generation_logs"])
