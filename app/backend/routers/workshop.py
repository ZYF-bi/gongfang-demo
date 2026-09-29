import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from dependencies.auth import get_current_user
from schemas.aihub import ChatMessage, GenTxtRequest
from schemas.auth import UserResponse
from services.aihub import AIHubService

router = APIRouter(prefix="/api/v1/workshop", tags=["workshop"])


class Msg(BaseModel):
    role: str
    content: str


class GenerateBody(BaseModel):
    model: str = "claude-opus-4.6"
    messages: List[Msg] = Field(..., min_length=1)


class GenerateResult(BaseModel):
    content: str


@router.post("/generate", response_model=GenerateResult)
async def generate(body: GenerateBody, current_user: UserResponse = Depends(get_current_user)):
    try:
        req = GenTxtRequest(
            model=body.model,
            messages=[ChatMessage(role=m.role, content=m.content) for m in body.messages],
            max_tokens=16000,
        )
        res = await AIHubService().gentxt(req)
        return GenerateResult(content=res.content or "")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"workshop generate error (user {current_user.id}): {e}")
        raise HTTPException(status_code=502, detail="模型服务调用失败，请稍后重试")
