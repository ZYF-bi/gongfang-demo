import { createClient } from '@metagptx/web-sdk';

export const client = createClient();
export const MODEL = 'claude-opus-4.6';
export const MODELS = [
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6（默认，代码质量高）' },
  { id: 'gpt-5.5', label: 'GPT-5.5（通用）' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro（长内容）' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（中文表现好）' },
];
export const MAX_PROMPT = 2000;
export const MAX_HTML_BYTES = 200_000;
const DRAFT_KEY = 'xiaoyan_draft_v1';

export type Project = {
  id: number;
  name: string;
  original_prompt: string;
  applied_changes: string;
  html: string;
  revision: number;
  share_token?: string | null;
  messages?: string;
  updated_at?: string;
};

export type Version = {
  id: number;
  project_id: number;
  revision: number;
  prompt?: string;
  summary?: string;
  html: string;
  created_at?: string;
};

export type Turn = { role: 'user' | 'ai'; text: string; error?: boolean; revision?: number };

export type Draft = {
  id?: number;
  name: string;
  original_prompt: string;
  changes: string[];
  html: string;
  revision: number;
  turns: Turn[];
  undo: string[];
};

export const parseChanges = (raw: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export const loadLocalDraft = (): { draft: Draft; dirty: boolean } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return v?.draft?.html ? v : null;
  } catch {
    return null;
  }
};

export const saveLocalDraft = (draft: Draft | null, dirty: boolean) => {
  try {
    if (!draft) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: { ...draft, undo: draft.undo.slice(-5) }, dirty }));
  } catch {
    /* 存储空间不足时忽略，不影响使用 */
  }
};

export const SYSTEM = `你是一个单页网页应用开发智能体。将用户需求实现为可直接运行的中文网页。
输出格式：第一行是 <!-- 说明：用一两句话说明本次做了什么 -->，随后是完整 HTML，从 <!DOCTYPE html> 到 </html>，不要 Markdown 或其他解释。
CSS 和 JavaScript 必须内联。禁止外部脚本、外部字体、外部图片、网络请求、iframe、跳转、下载和第三方服务。
运行环境是仅允许脚本的 sandbox iframe，不允许访问父页面、Cookie、localStorage、sessionStorage、indexedDB。应用内数据只在内存中保存。
实现真实交互、清晰布局、输入校验和错误提示；不要使用占位按钮。用浏览器原生能力实现，不使用框架依赖。
页面需适配手机、平板和电脑宽度。
如果需求超出单页本地工具范围，制作明确说明限制的页面，不假装已连接后台。修改时保留仍被需要的原功能。`;

export const buildUserMessage = (prompt: string, base?: Draft | null) =>
  base
    ? `原始需求：${base.original_prompt}\n已应用修改：${JSON.stringify(base.changes)}\n当前代码：\n${base.html}\n本次修改：${prompt}`
    : prompt;

export function parseOutput(raw: string): { html: string; summary: string } {
  const text = raw.replace(/```(?:html)?/gi, '');
  const note = text.match(/<!--\s*说明[:：]\s*([\s\S]*?)-->/);
  const summary = note ? note[1].trim().slice(0, 300) : '';
  const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
  if (start < 0) throw new Error('模型未返回网页代码，请重试');
  const endMatch = /<\/html\s*>/gi;
  let end = -1;
  for (let m; (m = endMatch.exec(text)); ) end = m.index + m[0].length;
  if (end < 0) throw new Error('生成代码被截断，请缩小需求后重试');
  return { html: validateHtml(text.slice(start, end).trim()), summary };
}

export function validateHtml(html: string): string {
  if (!html.trim()) throw new Error('代码不能为空');
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error('代码超过 200 KB，请精简后重试');
  if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html) || !/<\/html\s*>/i.test(html))
    throw new Error('代码必须是完整网页（包含 <html>、<body> 和 </html>）');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('script[src], link[href]'))
    throw new Error('代码引用了外部资源（script src / link href），请改为内联');
  return html;
}

const FORBIDDEN = 'iframe,frame,frameset,object,embed,base,meta,link';
const STRIP_ATTRS = ['src', 'srcset', 'href', 'action', 'formaction', 'target', 'ping', 'download', 'srcdoc', 'xlink:href'];
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function buildPreview(html: string, channel: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const clean = (root: ParentNode) => {
    root.querySelectorAll(FORBIDDEN).forEach((n) => n.remove());
    root.querySelectorAll('*').forEach((el) => {
      for (const a of STRIP_ATTRS) {
        if (!el.hasAttribute(a)) continue;
        const keep = el.tagName === 'IMG' && a === 'src' && (el.getAttribute('src') || '').startsWith('data:image/');
        if (!keep) el.removeAttribute(a);
      }
      if (el instanceof HTMLTemplateElement) clean(el.content);
    });
  };
  clean(doc);
  const guard = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>(()=>{const c=${JSON.stringify(channel)};const send=(t)=>parent.postMessage({type:'preview-error',channel:c,message:String(t).slice(0,300)},'*');window.addEventListener('error',e=>send(e.message));window.addEventListener('unhandledrejection',()=>send('应用发生未处理错误'));document.addEventListener('submit',e=>e.preventDefault());document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('a'))e.preventDefault();},true);})();</script>`;
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML.replace(/<head(\s[^>]*)?>/i, (m) => m + guard);
}

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

export function diffLines(a: string, b: string): DiffLine[] | null {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) return null;
  const n = x.length;
  const m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ type: 'same', text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: x[i++] });
    else out.push({ type: 'add', text: y[j++] });
  }
  while (i < n) out.push({ type: 'del', text: x[i++] });
  while (j < m) out.push({ type: 'add', text: y[j++] });
  return out;
}

export function downloadHtml(name: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'page'}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const errorText = (e: unknown) => {
  const x = e as { data?: { detail?: unknown }; response?: { data?: { detail?: unknown }; status?: number }; message?: string };
  const d = x?.data?.detail ?? x?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return '请求参数有误，请检查后重试';
  if (x?.response?.status === 401) return '登录已过期，请重新登录';
  return x?.message || '请求失败，请重试';
};

export function applyEmailToken(token: string) {
  localStorage.setItem('token', token);
  localStorage.setItem('isLougOutManual', 'false');
}
