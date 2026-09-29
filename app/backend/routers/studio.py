"""工坊核心接口：服务端固定提示词的生成、配额、带版本检查的保存和历史恢复。"""
import json
import logging
import re
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.generation_logs import Generation_logs
from models.project_versions import Project_versions
from models.projects import Projects
from schemas.aihub import ChatMessage, GenTxtRequest
from schemas.auth import UserResponse
from services.aihub import AIHubService

router = APIRouter(prefix="/api/v1/studio", tags=["studio"])

ALLOWED_MODELS = {"claude-opus-4.6", "gpt-5.5", "gemini-3.1-pro-preview", "deepseek-v4-pro"}
DEFAULT_MODEL = "claude-opus-4.6"
MAX_PROMPT = 2000
MAX_HTML_BYTES = 200_000
HOUR_LIMIT = 10
DAY_LIMIT = 30
MAX_MESSAGES = 100

SYSTEM = """你是一个单页网页应用开发智能体。将用户需求实现为可直接运行的中文网页。
输出格式：第一行是 <!-- 说明：用一两句话说明本次做了什么，以及仍有哪些限制 -->，随后是完整 HTML，从 <!DOCTYPE html> 到 </html>，不要 Markdown 或其他解释。
CSS 和 JavaScript 必须内联。禁止外部脚本、外部字体、外部图片、网络请求、iframe、跳转、下载和第三方服务。
运行环境是仅允许脚本的 sandbox iframe，不允许访问父页面、Cookie、localStorage、sessionStorage、indexedDB。应用内数据只在内存中保存。
实现真实交互、清晰布局、输入校验和错误提示；不要使用占位按钮。用浏览器原生能力实现，不使用框架依赖。页面需适配手机、平板和电脑宽度。
如果需求超出单页本地工具范围，制作明确说明限制的页面，不假装已连接后台。修改时保留用户没有要求删除的原有功能。"""

ENHANCE_SYSTEM = "你是产品需求助手。把用户简短的网页需求扩写成清晰、具体的中文需求描述，包括核心功能、交互细节和界面风格，不超过 300 字。只输出需求本身，不要标题、解释或 Markdown。"


class GenerateBody(BaseModel):
    prompt: str
    project_id: Optional[int] = None
    model: str = DEFAULT_MODEL


class GenerateResult(BaseModel):
    html: str
    summary: str
    remaining_hour: int


class EnhanceBody(BaseModel):
    prompt: str
    model: str = DEFAULT_MODEL


class Turn(BaseModel):
    role: str
    text: str
    revision: Optional[int] = None


class SaveBody(BaseModel):
    project_id: Optional[int] = None
    base_revision: int = 0
    name: str
    original_prompt: str
    changes: List[str] = Field(default_factory=list)
    messages: List[Turn] = Field(default_factory=list)
    html: str
    prompt: str = ""
    summary: str = ""


class RestoreBody(BaseModel):
    project_id: int
    version_id: int
    base_revision: int


class ProjectOut(BaseModel):
    id: int
    name: str
    original_prompt: str
    applied_changes: str
    messages: str
    html: str
    revision: int
    share_token: Optional[str] = None
    updated_at: Optional[datetime] = None


def _out(p: Projects) -> ProjectOut:
    return ProjectOut(
        id=p.id, name=p.name, original_prompt=p.original_prompt, applied_changes=p.applied_changes or "[]",
        messages=p.messages or "[]", html=p.html, revision=p.revision, share_token=p.share_token, updated_at=p.updated_at,
    )


def _check_prompt(prompt: str) -> str:
    p = (prompt or "").strip()
    if not p:
        raise HTTPException(status_code=400, detail="请输入有效需求")
    if len(p) > MAX_PROMPT:
        raise HTTPException(status_code=400, detail="需求最多 2,000 字符")
    return p


def _check_html(html: str) -> None:
    if not html or len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise HTTPException(status_code=400, detail="代码为空或超过 200 KB")
    if not re.search(r"<html[\s>]", html, re.I) or not re.search(r"</html\s*>", html, re.I):
        raise HTTPException(status_code=400, detail="代码必须是完整网页")


def _extract(raw: str) -> tuple:
    text = re.sub(r"```(?:html)?", "", raw or "", flags=re.I)
    note = re.search(r"<!--\s*说明[:：]\s*([\s\S]*?)-->", text)
    summary = note.group(1).strip()[:300] if note else ""
    start = re.search(r"<!DOCTYPE html|<html[\s>]", text, re.I)
    ends = list(re.finditer(r"</html\s*>", text, re.I))
    if not start:
        raise HTTPException(status_code=502, detail="模型未返回网页代码，请重试")
    if not ends:
        raise HTTPException(status_code=502, detail="生成代码被截断，请缩小需求后重试")
    html = text[start.start(): ends[-1].end()].strip()
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise HTTPException(status_code=502, detail="生成代码超过 200 KB，请缩小需求后重试")
    if re.search(r"<script[^>]*\bsrc\s*=", html, re.I) or re.search(r"<link[^>]*\bhref\s*=", html, re.I):
        raise HTTPException(status_code=502, detail="生成结果依赖外部资源，请补充“不使用外部依赖”后重试")
    return html, summary


async def _quota(db: AsyncSession, uid: str) -> int:
    now = datetime.now()
    hour = await db.scalar(select(func.count()).select_from(Generation_logs).where(
        Generation_logs.user_id == uid, Generation_logs.created_at > now - timedelta(hours=1)))
    day = await db.scalar(select(func.count()).select_from(Generation_logs).where(
        Generation_logs.user_id == uid, Generation_logs.created_at > now - timedelta(days=1)))
    if (day or 0) >= DAY_LIMIT:
        raise HTTPException(status_code=429, detail=f"今日 AI 调用已达 {DAY_LIMIT} 次上限，请明天再试")
    if (hour or 0) >= HOUR_LIMIT:
        raise HTTPException(status_code=429, detail=f"每小时最多 {HOUR_LIMIT} 次 AI 调用，请稍后再试")
    return HOUR_LIMIT - (hour or 0) - 1


async def _run(db: AsyncSession, uid: str, model: str, mode: str, messages: List[ChatMessage]) -> tuple:
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail="不支持的模型")
    remaining = await _quota(db, uid)
    log = Generation_logs(user_id=uid, model=model, mode=mode, status="running")
    db.add(log)
    await db.commit()
    status, usage = "failed", None
    try:
        res = await AIHubService().gentxt(GenTxtRequest(model=model, messages=messages, max_tokens=16000))
        usage = json.dumps(res.usage) if res.usage else None
        status = "succeeded"
        return res.content or "", remaining
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("studio %s failed: %s", mode, type(exc).__name__)
        if "insufficient" in str(exc).lower():
            raise HTTPException(status_code=503, detail="AI 余额不足，暂时无法生成，请联系应用发布者充值后重试")
        raise HTTPException(status_code=502, detail="模型服务调用失败，请稍后重试")
    finally:
        log.status = status
        log.usage = usage
        await db.commit()


@router.post("/generate", response_model=GenerateResult)
async def generate(body: GenerateBody, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = str(user.id)
    prompt = _check_prompt(body.prompt)
    user_msg = prompt
    if body.project_id is not None:
        p = (await db.execute(select(Projects).where(Projects.id == body.project_id, Projects.user_id == uid))).scalars().first()
        if not p:
            raise HTTPException(status_code=404, detail="项目不存在")
        changes = p.applied_changes or "[]"
        if len(changes) > 8000:
            changes = "（较早的修改已省略）" + changes[-8000:]
        user_msg = f"原始需求：{p.original_prompt}\n已应用修改：{changes}\n当前代码：\n{p.html}\n本次修改：{prompt}"
        await db.commit()
    raw, remaining = await _run(db, uid, body.model, "generate",
                                [ChatMessage(role="system", content=SYSTEM), ChatMessage(role="user", content=user_msg)])
    html, summary = _extract(raw)
    return GenerateResult(html=html, summary=summary, remaining_hour=max(0, remaining))


@router.post("/enhance")
async def enhance(body: EnhanceBody, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prompt = _check_prompt(body.prompt)
    raw, _ = await _run(db, str(user.id), body.model, "enhance",
                        [ChatMessage(role="system", content=ENHANCE_SYSTEM), ChatMessage(role="user", content=prompt)])
    text = raw.strip()[:MAX_PROMPT]
    if not text:
        raise HTTPException(status_code=502, detail="AI 没有返回内容，请重试")
    return {"prompt": text}


def _messages_json(turns: List[Turn]) -> str:
    kept = [{"role": t.role if t.role in ("user", "ai") else "ai", "text": t.text[:2000], "revision": t.revision}
            for t in turns[-MAX_MESSAGES:]]
    return json.dumps(kept, ensure_ascii=False)


@router.post("/save", response_model=ProjectOut)
async def save(body: SaveBody, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = str(user.id)
    _check_html(body.html)
    name = (body.name or "").strip()[:40] or "未命名项目"
    changes = json.dumps([c[:MAX_PROMPT] for c in body.changes][-200:], ensure_ascii=False)
    if body.project_id is None:
        p = Projects(user_id=uid, name=name, original_prompt=body.original_prompt[:MAX_PROMPT], applied_changes=changes,
                     messages=_messages_json(body.messages), html=body.html, revision=1)
        db.add(p)
        await db.flush()
    else:
        p = (await db.execute(select(Projects).where(Projects.id == body.project_id, Projects.user_id == uid)
                              .with_for_update())).scalars().first()
        if not p:
            raise HTTPException(status_code=404, detail="项目不存在")
        if p.revision != body.base_revision:
            raise HTTPException(status_code=409, detail=f"项目已在其他窗口更新到第 {p.revision} 版，本次结果未保存")
        if p.html == body.html and p.name == name:
            p.messages = _messages_json(body.messages)
            await db.commit()
            return _out(p)
        p.name, p.applied_changes, p.messages, p.html = name, changes, _messages_json(body.messages), body.html
        p.revision = p.revision + 1
    db.add(Project_versions(user_id=uid, project_id=p.id, revision=p.revision, prompt=body.prompt[:MAX_PROMPT],
                            summary=body.summary[:300], html=body.html))
    await db.commit()
    return _out(p)


@router.post("/restore", response_model=ProjectOut)
async def restore(body: RestoreBody, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = str(user.id)
    p = (await db.execute(select(Projects).where(Projects.id == body.project_id, Projects.user_id == uid)
                          .with_for_update())).scalars().first()
    v = (await db.execute(select(Project_versions).where(Project_versions.id == body.version_id,
                                                         Project_versions.project_id == body.project_id,
                                                         Project_versions.user_id == uid))).scalars().first()
    if not p or not v:
        raise HTTPException(status_code=404, detail="项目或版本不存在")
    if p.revision != body.base_revision:
        raise HTTPException(status_code=409, detail=f"项目已在其他窗口更新到第 {p.revision} 版，请刷新后再恢复")
    p.html = v.html
    p.revision = p.revision + 1
    turns = json.loads(p.messages or "[]")
    turns.append({"role": "ai", "text": f"已恢复第 {v.revision} 版的代码，保存为第 {p.revision} 版。", "revision": p.revision})
    p.messages = json.dumps(turns[-MAX_MESSAGES:], ensure_ascii=False)
    db.add(Project_versions(user_id=uid, project_id=p.id, revision=p.revision, prompt=f"恢复自第 {v.revision} 版",
                            summary="", html=v.html))
    await db.commit()
    return _out(p)
