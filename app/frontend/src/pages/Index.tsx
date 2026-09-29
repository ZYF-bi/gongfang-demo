import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Plus, Save, Trash2, LogIn, LogOut, Sparkles, UserRound, RotateCcw, FolderOpen, Wand2, Undo2,
  Monitor, Tablet, Smartphone, Maximize2, Minimize2, ExternalLink, Copy, Download, Code2, Eye, History, Check,
  Search, Pencil, CopyPlus, Upload, RefreshCw, Wrench, KeyRound, Square, Lightbulb, Share2, FileDown, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  client, MODEL, MODELS, MAX_PROMPT, validateHtml, buildPreview, parseChanges,
  errorText, loadLocalDraft, saveLocalDraft, diffLines, downloadHtml, type Draft, type Project, type Version, type Turn,
} from '@/lib/workshop';

type Auth = 'loading' | 'in' | 'out';
type Tab = 'preview' | 'code' | 'versions';
type Device = 'desktop' | 'tablet' | 'mobile';
const EXAMPLES = [
  '番茄钟计时器，可设置时长', '记账小工具，按类别汇总', '随机抽签器，输入名单抽取',
  '待办清单，支持完成和筛选', 'BMI 计算器，给出健康建议', '2048 小游戏，支持键盘操作',
  '个人简历展示页，简洁大方', '倒数日，显示距离重要日子的天数',
];
const DEVICES: Record<Device, { w: string; label: string; icon: typeof Monitor }> = {
  desktop: { w: '100%', label: '电脑', icon: Monitor },
  tablet: { w: '768px', label: '平板', icon: Tablet },
  mobile: { w: '375px', label: '手机', icon: Smartphone },
};
const STAGES = ['提交需求', 'AI 编写代码', '校验代码', '保存到云端'];
const FOLLOW_UPS = ['换成深色主题', '适配手机屏幕', '增加动画效果', '优化排版和配色', '添加使用说明'];
const PENDING_KEY = 'xiaoyan_pending_prompt';

const ago = (s?: string) => {
  if (!s) return '';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(s).toLocaleDateString('zh-CN');
};
const MIN_RATIO = 1 / 3;
const MAX_RATIO = 2 / 3;

const fromProject = (p: Project): Draft => {
  const changes = parseChanges(p.applied_changes);
  let turns: Turn[] = [];
  try {
    const t = JSON.parse(p.messages || '[]');
    if (Array.isArray(t)) turns = t.filter((x) => x && typeof x.text === 'string').map((x) => ({ role: x.role === 'user' ? 'user' : 'ai', text: x.text, revision: x.revision ?? undefined }));
  } catch { /* 旧数据没有对话记录 */ }
  if (!turns.length) turns = [{ role: 'user', text: p.original_prompt }, ...changes.map((c) => ({ role: 'user', text: c } as Turn))];
  return { id: p.id, name: p.name, original_prompt: p.original_prompt, changes, html: p.html, revision: p.revision, undo: [], turns };
};

const newDraft = (prompt: string, html: string, summary: string): Draft => ({
  name: prompt.slice(0, 20), original_prompt: prompt, changes: [], html, revision: 0, undo: [],
  turns: [{ role: 'user', text: prompt }, { role: 'ai', text: summary || '已生成网页，可在右侧预览。' }],
});

export default function Index() {
  const navigate = useNavigate();
  const restored = useMemo(() => loadLocalDraft(), []);
  const [auth, setAuth] = useState<Auth>('loading');
  const [account, setAccount] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Draft | null>(restored?.draft ?? null);
  const [dirty, setDirty] = useState(restored?.dirty ?? false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [ratio, setRatio] = useState(0.38);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<Tab>('preview');
  const [device, setDevice] = useState<Device>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [code, setCode] = useState(draft?.html ?? '');
  const [versions, setVersions] = useState<Version[]>([]);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [isEmail, setIsEmail] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState({ old: '', next: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem('xiaoyan_model') || MODEL);
  const [sharing, setSharing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const genId = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const channel = useMemo(() => Math.random().toString(36).slice(2), []);

  const loadProjects = useCallback(async () => {
    try {
      const r = await client.entities.projects.query({ query: {}, sort: '-updated_at', limit: 50 });
      setProjects(r.data?.items || []);
    } catch (e) {
      toast.error('加载项目失败：' + errorText(e));
    }
  }, []);

  const loadVersions = useCallback(async (projectId?: number) => {
    if (!projectId) return setVersions([]);
    try {
      const r = await client.entities.project_versions.query({ query: { project_id: projectId }, sort: '-revision', limit: 50 });
      setVersions(r.data?.items || []);
    } catch (e) {
      toast.error('加载历史版本失败：' + errorText(e));
    }
  }, []);

  useEffect(() => {
    client.auth.me()
      .then((r) => {
        if (!r?.data) return setAuth('out');
        setAuth('in');
        const pending = sessionStorage.getItem(PENDING_KEY);
        if (pending) { setPrompt(pending); sessionStorage.removeItem(PENDING_KEY); toast('已恢复你登录前填写的需求，确认后点击生成'); }
        const email = String(r.data.id || '').startsWith('email-');
        setIsEmail(email);
        setAccount(email ? '邮箱账号' : '平台账号');
        loadProjects();
      })
      .catch(() => setAuth('out'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { saveLocalDraft(draft, dirty); }, [draft, dirty]);
  useEffect(() => { localStorage.setItem('xiaoyan_model', model); }, [model]);
  useEffect(() => { setCode(draft?.html ?? ''); }, [draft?.html]);
  useEffect(() => { if (auth === 'in') loadVersions(draft?.id); }, [auth, draft?.id, loadVersions]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [draft?.turns.length, busy]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; channel?: string; message?: string };
      if (e.source !== frameRef.current?.contentWindow) return;
      if (d?.type === 'preview-error' && d.channel === channel && typeof d.message === 'string') setPreviewError(d.message);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [channel]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (box) setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, (e.clientX - box.left) / box.width)));
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging]);

  useEffect(() => {
    if (!fullscreen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [fullscreen]);

  const srcDoc = useMemo(() => (draft ? buildPreview(draft.html, channel) : ''), [draft, channel]);

  const applyHtml = (html: string, change: string, aiText: string, userText?: string) => {
    setDraft((d) => d && {
      ...d, html, changes: [...d.changes, change], undo: [...d.undo, d.html].slice(-10),
      turns: [...d.turns, ...(userText ? [{ role: 'user', text: userText } as Turn] : []), { role: 'ai', text: aiText }],
    });
    setDirty(true); setPreviewError('');
  };

  const goLogin = () => {
    if (prompt.trim()) sessionStorage.setItem(PENDING_KEY, prompt.trim());
    navigate('/login');
  };

  const persist = async (d: Draft, promptText: string, summary: string): Promise<Draft | null> => {
    setSaving(true); setSaveError('');
    try {
      const r = await client.apiCall.invoke({
        url: '/api/v1/studio/save', method: 'POST',
        data: { project_id: d.id ?? null, base_revision: d.revision, name: d.name, original_prompt: d.original_prompt,
          changes: d.changes, messages: d.turns, html: d.html, prompt: promptText, summary },
      });
      const out = r.data as Project;
      const saved: Draft = { ...d, id: out.id, revision: out.revision };
      setDraft((cur) => (cur && cur.html === d.html ? { ...cur, id: out.id, revision: out.revision } : cur));
      setDirty(false);
      setProjects((ps) => [out, ...ps.filter((x) => x.id !== out.id)]);
      loadVersions(out.id);
      return saved;
    } catch (e) {
      setSaveError(errorText(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const generate = async (text = prompt) => {
    const p = text.trim();
    if (auth !== 'in') return goLogin();
    if (!p) return setError('请输入有效需求');
    if ([...p].length > MAX_PROMPT) return setError('需求最多 2,000 字符');
    if (busy || saving) return;
    let base = draft;
    if (base && (dirty || !base.id)) {
      const saved = await persist(base, base.changes[base.changes.length - 1] || base.original_prompt, '');
      if (!saved) return setError('当前内容尚未保存到云端，请先点"重试保存"再继续修改');
      base = saved;
    }
    const my = ++genId.current;
    setBusy(true); setError(''); setLastPrompt(p); setStage(0); setElapsed(0);
    try {
      setStage(1);
      const r = await client.apiCall.invoke({
        url: '/api/v1/studio/generate', method: 'POST',
        data: { prompt: p, project_id: base?.id ?? null, model },
        options: { timeout: 600_000 },
      });
      if (my !== genId.current) return;
      setStage(2);
      const html = validateHtml(String(r?.data?.html ?? ''));
      const aiText = String(r?.data?.summary || '') || (base ? '已按要求完成修改。' : '已生成网页，可在右侧预览。');
      if (typeof r?.data?.remaining_hour === 'number') setRemaining(r.data.remaining_hour);
      const next: Draft = base
        ? { ...base, html, changes: [...base.changes, p], undo: [...base.undo, base.html].slice(-10), turns: [...base.turns, { role: 'user', text: p }, { role: 'ai', text: aiText }] }
        : newDraft(p, html, aiText);
      setDraft(next); setDirty(true); setPreviewError('');
      setPrompt(''); setTab('preview');
      setStage(3);
      await persist(next, p, aiText);
    } catch (e) {
      if (my !== genId.current) return;
      const msg = errorText(e);
      setError(msg);
      if (msg.includes('登录已过期')) setAuth('out');
    } finally {
      if (my === genId.current) setBusy(false);
    }
  };

  const cancel = () => {
    genId.current++;
    setBusy(false);
    toast('已停止生成，本次结果不会应用');
  };

  const enhance = async () => {
    if (auth !== 'in') return goLogin();
    const p = prompt.trim();
    if (!p) return setError('请先输入一句简单的需求');
    setEnhancing(true); setError('');
    try {
      const r = await client.apiCall.invoke({ url: '/api/v1/studio/enhance', method: 'POST', data: { prompt: p, model }, options: { timeout: 180_000 } });
      const text = String(r?.data?.prompt ?? '').trim();
      if (!text) throw new Error('AI 没有返回内容，请重试');
      setPrompt([...text].slice(0, MAX_PROMPT).join(''));
      toast.success('需求已完善，可以修改后再生成');
    } catch (e) {
      toast.error('完善需求失败：' + errorText(e));
    } finally {
      setEnhancing(false);
    }
  };

  const current = projects.find((p) => p.id === draft?.id);
  const shareUrl = current?.share_token ? `${window.location.origin}/s/${current.share_token}` : '';

  const toggleShare = async (enable: boolean) => {
    if (!draft?.id) return toast.error('请先保存项目再分享');
    setSharing(true);
    try {
      const r = await client.apiCall.invoke({ url: '/api/v1/share/toggle', method: 'POST', data: { project_id: draft.id, enable } });
      const token = r?.data?.share_token ?? null;
      setProjects((ps) => ps.map((p) => (p.id === draft.id ? { ...p, share_token: token } : p)));
      if (enable && token) {
        const url = `${window.location.origin}/s/${token}`;
        try { await navigator.clipboard.writeText(url); toast.success('分享链接已复制，别人无需登录即可查看'); }
        catch { toast.success('已开启分享'); }
      } else toast.success('已关闭分享，原链接失效');
    } catch (e) {
      toast.error('操作失败：' + errorText(e));
    } finally {
      setSharing(false);
    }
  };

  const exportAll = async () => {
    try {
      const r = await client.entities.projects.query({ query: {}, sort: '-updated_at', limit: 200 });
      const items = (r.data?.items || []).map((p: Project) => ({ name: p.name, original_prompt: p.original_prompt, changes: parseChanges(p.applied_changes), revision: p.revision, updated_at: p.updated_at, html: p.html }));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), projects: items }, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `小验工坊备份_${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`已导出 ${items.length} 个项目`);
    } catch (e) {
      toast.error('导出失败：' + errorText(e));
    }
  };

  const deleteAccount = async () => {
    if (delText !== '注销') return;
    setDelBusy(true);
    try {
      await client.apiCall.invoke({ url: '/api/v1/account/delete', method: 'POST', data: { confirm: delText } });
      saveLocalDraft(null, false);
      try { await client.auth.logout(); } catch { /* 本地凭证已清除 */ }
      toast.success('账号数据已删除');
      setTimeout(() => window.location.replace('/'), 500);
    } catch (e) {
      toast.error('注销失败：' + errorText(e));
      setDelBusy(false);
    }
  };

  const fixError = () => {
    if (!previewError) return;
    generate(`预览运行时报错：${previewError}。请修复这个错误，其他功能保持不变。`);
  };

  const duplicate = async (p: Project) => {
    try {
      const r = await client.entities.projects.create({
        data: { name: `${p.name} 副本`.slice(0, 40), original_prompt: p.original_prompt, applied_changes: p.applied_changes || '[]', html: p.html, revision: 1 },
      });
      await client.entities.project_versions.create({
        data: { project_id: Number(r.data.id), revision: 1, prompt: `复制自「${p.name}」`, summary: '', html: p.html },
      });
      toast.success('已创建副本');
      loadProjects();
    } catch (e) {
      toast.error('复制失败：' + errorText(e));
    }
  };

  const rename = async (p: Project) => {
    const name = renameText.trim().slice(0, 40);
    setRenaming(null);
    if (!name || name === p.name) return;
    try {
      await client.entities.projects.update({ id: String(p.id), data: { name } });
      if (draft?.id === p.id) setDraft((d) => d && { ...d, name });
      loadProjects();
    } catch (e) {
      toast.error('重命名失败：' + errorText(e));
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    if (!confirmLeave('当前修改未保存，确定导入新文件吗？')) return;
    try {
      const html = validateHtml(await file.text());
      setDraft({
        name: file.name.replace(/\.html?$/i, '').slice(0, 20) || '导入的网页', original_prompt: `导入文件 ${file.name}`,
        changes: [], html, revision: 0, undo: [], turns: [{ role: 'ai', text: `已导入 ${file.name}，可以继续让 AI 修改。` }],
      });
      setDirty(true); setPreviewError(''); setTab('preview');
      toast.success('导入成功');
    } catch (e) {
      toast.error('导入失败：' + errorText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changePassword = async () => {
    setPwdError('');
    if (!pwd.old) return setPwdError('请输入当前密码');
    if (pwd.next.length < 8 || pwd.next.length > 64) return setPwdError('新密码需要 8—64 个字符');
    if (!/[A-Za-z]/.test(pwd.next) || !/\d/.test(pwd.next)) return setPwdError('新密码须包含字母和数字');
    if (pwd.next !== pwd.confirm) return setPwdError('两次密码不一致');
    setPwdBusy(true);
    try {
      await client.apiCall.invoke({
        url: '/api/v1/email_auth/change_password',
        method: 'POST',
        data: { old_password: pwd.old, new_password: pwd.next, confirm_password: pwd.confirm },
      });
      toast.success('密码已修改，下次请用新密码登录');
      setPwdOpen(false); setPwd({ old: '', next: '', confirm: '' });
    } catch (e) {
      setPwdError(errorText(e));
    } finally {
      setPwdBusy(false);
    }
  };

  const undo = () => {
    setDraft((d) => {
      if (!d || !d.undo.length) return d;
      const html = d.undo[d.undo.length - 1];
      return { ...d, html, undo: d.undo.slice(0, -1), changes: d.changes.slice(0, -1), turns: [...d.turns, { role: 'ai', text: '已撤销上一步修改。' }] };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    if (auth !== 'in') return goLogin();
    const lastAi = [...draft.turns].reverse().find((t) => t.role === 'ai' && !t.error)?.text || '';
    const r = await persist(draft, draft.changes[draft.changes.length - 1] || draft.original_prompt, lastAi.slice(0, 300));
    if (r) toast.success(`已保存到账号（第 ${r.revision} 版）`);
  };

  const confirmLeave = (msg: string) => !dirty || confirm(msg);

  const open = (p: Project) => {
    if (busy || saving) return;
    if (!confirmLeave('当前修改未保存，确定切换吗？')) return;
    setDraft(fromProject(p));
    setDirty(false); setError(''); setSaveError(''); setPreviewError(''); setTab('preview'); setCompareId(null);
  };

  const remove = async (p: Project) => {
    if (!confirm(`确定删除「${p.name}」及其所有历史版本吗？`)) return;
    try {
      const vs = await client.entities.project_versions.query({ query: { project_id: p.id }, limit: 200, fields: ['id'] });
      await Promise.all((vs.data?.items || []).map((v: { id: number }) => client.entities.project_versions.delete({ id: String(v.id) })));
      await client.entities.projects.delete({ id: String(p.id) });
      if (draft?.id === p.id) { setDraft(null); setDirty(false); }
      toast.success('已删除');
      loadProjects();
    } catch (e) {
      toast.error('删除失败：' + errorText(e));
    }
  };

  const restore = async (v: Version) => {
    if (!draft?.id || busy || saving) return;
    if (dirty && !confirm('当前有未保存的修改，恢复后会被丢弃，确定吗？')) return;
    if (!confirm(`确定恢复到第 ${v.revision} 版吗？会生成一个新版本，原有历史版本都保留。`)) return;
    setSaving(true);
    try {
      const r = await client.apiCall.invoke({ url: '/api/v1/studio/restore', method: 'POST', data: { project_id: draft.id, version_id: v.id, base_revision: draft.revision } });
      const out = r.data as Project;
      setDraft(fromProject(out)); setDirty(false); setSaveError(''); setCompareId(null);
      setProjects((ps) => [out, ...ps.filter((x) => x.id !== out.id)]);
      loadVersions(out.id); setTab('preview');
      toast.success(`已恢复，保存为第 ${out.revision} 版`);
    } catch (e) {
      toast.error('恢复失败：' + errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const applyCode = () => {
    if (!draft || code === draft.html) return;
    try {
      applyHtml(validateHtml(code), '手动编辑代码', '已应用你手动编辑的代码。');
      toast.success('代码已应用');
      setTab('preview');
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(draft?.html || ''); toast.success('代码已复制'); }
    catch { toast.error('复制失败，请在代码框中手动复制'); }
  };

  const openWindow = () => {
    const w = window.open('', '_blank');
    if (!w) return toast.error('浏览器拦截了新窗口，请允许弹出窗口');
    const esc = srcDoc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${(draft?.name || '预览').replace(/</g, '&lt;')}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts" srcdoc="${esc}"></iframe></body></html>`);
    w.document.close();
  };

  const logout = async () => {
    if (!confirmLeave('当前修改未保存，确定退出登录吗？')) return;
    try { await client.auth.logout(); } catch { /* 本地凭证已清除 */ }
    saveLocalDraft(null, false);
    setAuth('out'); setProjects([]); setDraft(null); setDirty(false);
    toast.success('已退出登录');
    setTimeout(() => window.location.replace('/'), 300);
  };

  const reset = () => {
    if (!confirmLeave('当前修改未保存，确定新建吗？')) return;
    setDraft(null); setDirty(false); setPrompt(''); setError(''); setPreviewError(''); setTab('preview');
  };

  const compare = versions.find((v) => v.id === compareId);
  const diff = useMemo(() => (compare && draft ? diffLines(compare.html, draft.html) : null), [compare, draft]);

  const card = 'bg-white border border-[#E5E7EB] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]';
  const primaryBtn = 'h-10 rounded-[10px] bg-[#2F6BFF] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#2459DB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
  const ghostBtn = 'h-8 px-2.5 rounded-[8px] text-xs flex items-center gap-1 text-[#374151] !bg-transparent hover:!bg-[#F3F4F6] disabled:opacity-40';

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-[#F7F8FA] text-[#111827]" style={{ fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
      <header className="h-14 shrink-0 bg-white border-b border-[#E5E7EB] px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-[#2F6BFF] text-white flex items-center justify-center"><Wand2 className="w-4 h-4" /></span>
          <span className="text-lg font-semibold">小验工坊</span>
          <span className="hidden sm:inline text-xs text-[#6B7280] ml-2">一句话生成可运行网页</span>
        </div>
        {auth === 'loading' && <span className="text-xs text-[#6B7280] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />检查登录状态…</span>}
        {auth === 'in' && (
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[#F0FDF4] text-[#15803D]"><span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />已登录 · {account}</span>
            <span className="w-8 h-8 rounded-full bg-[#EEF3FF] text-[#2F6BFF] flex items-center justify-center"><UserRound className="w-4 h-4" aria-hidden /></span>
            {isEmail && <button aria-label="修改密码" title="修改密码" onClick={() => { setPwdError(''); setPwdOpen(true); }} className="h-8 px-2 rounded-lg text-xs text-[#6B7280] hover:bg-[#F3F4F6] flex items-center gap-1"><KeyRound className="w-4 h-4" /><span className="hidden sm:inline">改密码</span></button>}
            <button aria-label="注销账号" title="注销账号" onClick={() => { setDelText(''); setDelOpen(true); }} className="h-8 px-2 rounded-lg text-xs text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#DC2626] flex items-center gap-1"><UserX className="w-4 h-4" /></button>
            <button aria-label="退出登录" title="退出登录" onClick={logout} className="h-8 px-2 rounded-lg text-xs text-[#6B7280] hover:bg-[#F3F4F6] flex items-center gap-1"><LogOut className="w-4 h-4" /><span className="hidden sm:inline">退出</span></button>
          </div>
        )}
        {auth === 'out' && (
          <button onClick={() => goLogin()} className="h-9 px-4 rounded-[10px] bg-[#2F6BFF] text-white text-sm flex items-center gap-1 hover:bg-[#2459DB]"><LogIn className="w-4 h-4" />登录 / 注册</button>
        )}
      </header>

      <div ref={splitRef} className={`flex-1 min-h-0 flex flex-col md:flex-row ${dragging ? 'select-none cursor-col-resize' : ''}`}>
        <aside className="md:h-full md:overflow-y-auto p-4 flex flex-col gap-4 md:[width:var(--left)] shrink-0" style={{ ['--left' as string]: `${ratio * 100}%` }}>
          <section className={`${card} p-4 flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{draft ? '与 AI 对话修改' : '描述你想要的网页'}</h2>
              {draft && (
                <div className="flex items-center gap-1">
                  <button onClick={undo} disabled={busy || !draft.undo.length} className={ghostBtn} title="撤销上一步"><Undo2 className="w-3.5 h-3.5" />撤销</button>
                  <button onClick={reset} disabled={busy || saving} className={ghostBtn}><Plus className="w-3.5 h-3.5" />新建</button>
                </div>
              )}
            </div>

            {draft && (
              <div className="max-h-64 overflow-y-auto flex flex-col gap-2 pr-1">
                {draft.turns.map((t, i) => (
                  <div key={i} className={`text-sm rounded-[10px] px-3 py-2 max-w-[92%] whitespace-pre-wrap break-words ${t.role === 'user' ? 'self-end bg-[#2F6BFF] text-white' : 'self-start bg-[#F3F4F6] text-[#374151]'}`}>{t.text}</div>
                ))}
                {busy && (
                  <div className="self-start w-full rounded-[10px] bg-[#EEF3FF] px-3 py-2 text-xs text-[#2F6BFF]">
                    <ol className="flex flex-col gap-1">
                      {STAGES.map((s, i) => (
                        <li key={s} className={`flex items-center gap-2 ${i > stage ? 'opacity-40' : ''}`}>
                          {i < stage ? <Check className="w-3 h-3" /> : i === stage ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="w-3 h-3 rounded-full border border-current" />}{s}
                        </li>
                      ))}
                    </ol>
                    <div className="mt-1 text-[#6B7280]">已用时 {elapsed} 秒，通常需要 1–2 分钟</div>
                  </div>
                )}
                {!busy && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {FOLLOW_UPS.map((f) => <button key={f} onClick={() => setPrompt(f)} className="text-xs px-2 py-1 rounded-full border border-[#E5E7EB] text-[#374151] hover:border-[#2F6BFF] hover:text-[#2F6BFF]">{f}</button>)}
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
            )}

            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} rows={draft ? 3 : 5}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate(); }}
              placeholder={draft ? '继续描述修改，例如：把按钮改成绿色，并增加重置功能' : '例如：一个番茄钟计时器，可设置时长'}
              aria-label="需求描述"
              className="w-full rounded-[10px] bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/40 focus:border-[#2F6BFF] resize-none"
            />
            {!draft && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => <button key={ex} onClick={() => setPrompt(ex)} className="text-xs px-2.5 py-1.5 rounded-full bg-[#F3F4F6] text-[#374151] hover:bg-[#EEF3FF] hover:text-[#2F6BFF]">{ex}</button>)}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-[#6B7280]">
              <span className={[...prompt].length > MAX_PROMPT ? 'text-[#DC2626]' : ''}>\1{remaining !== null ? ` · 本小时还剩 ${remaining} 次` : ''}</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} aria-label="选择模型"
                className="h-7 max-w-[55%] rounded-[6px] border border-[#E5E7EB] bg-white px-1 text-xs text-[#374151] focus:outline-none focus:border-[#2F6BFF]">
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            {auth === 'out' ? (
              <button onClick={() => goLogin()} className={primaryBtn}><LogIn className="w-4 h-4" />登录后生成</button>
            ) : busy ? (
              <button onClick={cancel} className="h-10 rounded-[10px] border border-[#DC2626] text-[#DC2626] !bg-transparent hover:!bg-[#FEF2F2] font-medium flex items-center justify-center gap-2">
                <Square className="w-4 h-4" />停止生成（{elapsed} 秒）
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={enhance} disabled={enhancing || auth !== 'in' || !prompt.trim()} title="让 AI 把简短需求扩写得更具体"
                  className="h-10 px-3 rounded-[10px] border border-[#E5E7EB] text-[#374151] !bg-white hover:!bg-[#F9FAFB] text-sm flex items-center gap-1 disabled:opacity-50 shrink-0">
                  {enhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4 text-[#F59E0B]" />}完善需求
                </button>
                <button onClick={() => generate()} disabled={enhancing || auth !== 'in' || !prompt.trim()} className={`${primaryBtn} flex-1`}>
                  <Sparkles className="w-4 h-4" />{draft ? '发送修改' : '生成网页'}
                </button>
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] p-3 text-sm text-[#DC2626]">
                {error}
                {lastPrompt && !busy && auth === 'in' && <button onClick={() => generate(lastPrompt)} className="ml-2 underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />重试</button>}
                {auth === 'out' && <button onClick={() => goLogin()} className="ml-2 underline">去登录</button>}
              </div>
            )}
          </section>

          {draft && (
            <section className={`${card} p-4 text-sm flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <h2 className="font-semibold truncate">{draft.name}</h2>
                <p className={`text-xs ${saveError ? 'text-[#DC2626]' : 'text-[#6B7280]'}`}>{draft.id ? `第 ${draft.revision} 版` : '新项目'} · {saving ? '保存中…' : saveError ? `保存失败：${saveError}` : dirty || !draft.id ? '未保存' : '已保存到账号'}</p>
              </div>
              {draft.id && (
                <button onClick={() => toggleShare(!shareUrl)} disabled={sharing} title={shareUrl ? '关闭分享' : '生成公开链接'}
                  className={`h-9 px-3 rounded-[10px] border text-sm flex items-center gap-1 disabled:opacity-50 shrink-0 !bg-transparent ${shareUrl ? 'border-[#16A34A] text-[#16A34A] hover:!bg-[#F0FDF4]' : 'border-[#E5E7EB] text-[#374151] hover:!bg-[#F9FAFB]'}`}>
                  {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}{shareUrl ? '已分享' : '分享'}
                </button>
              )}
              <button onClick={save} disabled={saving || busy || (!dirty && !!draft.id && !saveError)} className="h-9 px-3 rounded-[10px] border border-[#2F6BFF] text-[#2F6BFF] !bg-transparent hover:!bg-[#EEF3FF] flex items-center gap-1 disabled:opacity-50 shrink-0">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saveError ? '重试保存' : dirty || !draft.id ? '保存' : '已保存'}
              </button>
            </section>
          )}
          {shareUrl && (
            <div className="-mt-2 rounded-[10px] bg-[#F0FDF4] border border-[#BBF7D0] p-2 text-xs text-[#15803D] flex items-center gap-2">
              <span className="flex-1 truncate" title={shareUrl}>{shareUrl}</span>
              <button onClick={() => navigator.clipboard.writeText(shareUrl).then(() => toast.success('已复制')).catch(() => toast.error('复制失败'))} className="underline shrink-0">复制</button>
              <a href={shareUrl} target="_blank" rel="noreferrer" className="underline shrink-0">打开</a>
            </div>
          )}

          <section className={`${card} p-4 flex flex-col gap-2`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2"><FolderOpen className="w-4 h-4 text-[#6B7280]" />我的项目{auth === 'in' && projects.length > 0 && <span className="text-xs font-normal text-[#9CA3AF]">{projects.length}</span>}</h2>
              <div className="flex">
              {auth === 'in' && projects.length > 0 && <button onClick={exportAll} className={ghostBtn} title="导出全部项目为备份文件"><FileDown className="w-3.5 h-3.5" />备份</button>}
              <button onClick={() => fileRef.current?.click()} disabled={busy} className={ghostBtn} title="导入本地 HTML 文件"><Upload className="w-3.5 h-3.5" />导入 HTML</button>
              </div>
              <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
            </div>
            {auth === 'out' && <p className="text-sm text-[#6B7280]">登录后可生成、保存和查看项目。</p>}
            {auth === 'in' && projects.length === 0 && <p className="text-sm text-[#6B7280]">还没有保存的项目。</p>}
            {auth === 'in' && projects.length > 3 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索项目" aria-label="搜索项目"
                  className="w-full h-8 pl-8 pr-2 rounded-[8px] border border-[#E5E7EB] text-xs focus:outline-none focus:border-[#2F6BFF]" />
              </div>
            )}
            {projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).map((p) => (
              <div key={p.id} className={`group flex items-center rounded-[10px] border ${draft?.id === p.id ? 'border-[#2F6BFF] bg-[#EEF3FF]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}>
                {renaming === p.id ? (
                  <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} aria-label="项目名称" maxLength={40}
                    onBlur={() => rename(p)} onKeyDown={(e) => { if (e.key === 'Enter') rename(p); if (e.key === 'Escape') setRenaming(null); }}
                    className="flex-1 min-w-0 m-1.5 h-8 px-2 rounded-[6px] border border-[#2F6BFF] text-sm focus:outline-none" />
                ) : (
                  <button onClick={() => open(p)} disabled={busy || saving} className="flex-1 min-w-0 text-left px-3 py-2 text-sm">
                    <div className="truncate flex items-center gap-1">{p.name}{p.share_token && <Share2 className="w-3 h-3 text-[#16A34A] shrink-0" aria-label="已分享" />}</div>
                    <div className="text-xs text-[#6B7280]">第 {p.revision} 版{p.updated_at ? ' · ' + ago(p.updated_at) : ''}</div>
                  </button>
                )}
                <button aria-label={`重命名 ${p.name}`} title="重命名" onClick={() => { setRenaming(p.id); setRenameText(p.name); }} className="p-2 text-[#9CA3AF] hover:text-[#2F6BFF]"><Pencil className="w-3.5 h-3.5" /></button>
                <button aria-label={`复制 ${p.name}`} title="创建副本" onClick={() => duplicate(p)} className="p-2 text-[#9CA3AF] hover:text-[#2F6BFF]"><CopyPlus className="w-3.5 h-3.5" /></button>
                <button aria-label={`删除 ${p.name}`} title="删除" onClick={() => remove(p)} disabled={busy || saving} className="p-2 pr-3 text-[#9CA3AF] hover:text-[#DC2626]"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {auth === 'in' && search && !projects.some((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())) && <p className="text-xs text-[#6B7280]">没有匹配的项目。</p>}
          </section>
        </aside>

        <div
          role="separator" aria-orientation="vertical" aria-label="拖动调整左右宽度"
          onPointerDown={(e) => { e.preventDefault(); setDragging(true); }}
          onDoubleClick={() => setRatio(0.38)}
          className="hidden md:flex w-2 shrink-0 cursor-col-resize items-center justify-center group"
        >
          <div className={`w-[3px] h-12 rounded-full transition-colors ${dragging ? 'bg-[#2F6BFF]' : 'bg-[#D1D5DB] group-hover:bg-[#2F6BFF]'}`} />
        </div>

        <main className={fullscreen ? 'fixed inset-0 z-50 bg-[#F7F8FA] p-3 flex flex-col gap-3' : 'flex-1 min-w-0 min-h-0 p-4 md:pl-2 flex flex-col gap-3 h-[85vh] md:h-full'}>
          {previewError && tab === 'preview' && (
            <div role="alert" className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-sm text-[#DC2626] flex items-center gap-2">
              <span className="flex-1 min-w-0 break-words">预览运行出错：{previewError}</span>
              <button onClick={fixError} disabled={busy || auth !== 'in'} className="h-8 px-3 rounded-[8px] bg-[#DC2626] text-white text-xs flex items-center gap-1 shrink-0 disabled:opacity-50"><Wrench className="w-3.5 h-3.5" />让 AI 修复</button>
            </div>
          )}
          <div className={`${card} flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className="shrink-0 border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 p-0.5 rounded-[8px] bg-[#EEF0F3]" role="tablist">
                {([['preview', '预览', Eye], ['code', '代码', Code2], ['versions', '版本', History]] as const).map(([k, label, Icon]) => (
                  <button key={k} role="tab" aria-selected={tab === k} disabled={!draft} onClick={() => setTab(k)}
                    className={`h-7 px-2.5 rounded-[6px] text-xs flex items-center gap-1 disabled:opacity-40 ${tab === k ? 'bg-white shadow-sm text-[#111827]' : 'text-[#6B7280]'}`}><Icon className="w-3.5 h-3.5" />{label}</button>
                ))}
              </div>
              {tab === 'preview' && (
                <div className="flex gap-0.5">
                  {(Object.keys(DEVICES) as Device[]).map((d) => {
                    const Icon = DEVICES[d].icon;
                    return <button key={d} aria-label={`${DEVICES[d].label}尺寸`} title={DEVICES[d].label} onClick={() => setDevice(d)} className={`w-7 h-7 rounded-[6px] flex items-center justify-center ${device === d ? 'bg-[#EEF3FF] text-[#2F6BFF]' : 'text-[#6B7280] hover:bg-[#EEF0F3]'}`}><Icon className="w-3.5 h-3.5" /></button>;
                  })}
                </div>
              )}
              <span className="flex-1 text-xs text-[#6B7280] truncate text-right">{draft?.name || '预览'}</span>
              {tab === 'preview' && <button onClick={() => { setPreviewError(''); setPreviewKey((k) => k + 1); }} disabled={!draft} className={ghostBtn} aria-label="刷新预览" title="刷新预览"><RefreshCw className="w-3.5 h-3.5" /></button>}
              <button onClick={copy} disabled={!draft} className={ghostBtn}><Copy className="w-3.5 h-3.5" />复制</button>
              <button onClick={() => draft && downloadHtml(draft.name, draft.html)} disabled={!draft} className={ghostBtn}><Download className="w-3.5 h-3.5" />下载</button>
              <button onClick={openWindow} disabled={!draft} className={ghostBtn} aria-label="新窗口打开"><ExternalLink className="w-3.5 h-3.5" /></button>
              <button onClick={() => setFullscreen((f) => !f)} className={ghostBtn} aria-label={fullscreen ? '退出全屏' : '全屏预览'}>{fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
            </div>

            <div className="relative flex-1 min-h-0">
              {!draft ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="w-14 h-14 rounded-2xl bg-[#EEF3FF] text-[#2F6BFF] flex items-center justify-center">{busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Sparkles className="w-7 h-7" />}</span>
                  <h2 className="text-lg font-semibold">{busy ? `AI 正在搭建你的网页…（${elapsed} 秒）` : '一句话，生成一个可运行的网页'}</h2>
                  <p className="text-sm text-[#6B7280] max-w-sm">{busy ? STAGES[stage] + '中，通常需要 1–2 分钟。' : '在左侧描述需求，生成后可在这里预览、查看代码、管理版本。'}</p>
                </div>
              ) : tab === 'preview' ? (
                <div className="h-full overflow-auto bg-[#EEF0F3] flex justify-center">
                  <iframe ref={frameRef} key={previewKey} title="网页预览" sandbox="allow-scripts" srcDoc={srcDoc} style={{ width: DEVICES[device].w }}
                    className={`block h-full border-0 bg-white max-w-full ${device !== 'desktop' ? 'shadow-md' : ''} ${dragging ? 'pointer-events-none' : ''}`} />
                </div>
              ) : tab === 'code' ? (
                <div className="h-full flex flex-col">
                  <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="网页代码"
                    className="flex-1 min-h-0 w-full p-3 font-mono text-xs leading-5 bg-[#0F172A] text-[#E2E8F0] resize-none focus:outline-none" />
                  <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-[#E5E7EB]">
                    <span className="text-xs text-[#6B7280]">{code !== draft.html ? '代码已修改，点击"应用"后生效' : `${new TextEncoder().encode(code).length.toLocaleString()} 字节`}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setCode(draft.html)} disabled={code === draft.html} className={ghostBtn}>放弃编辑</button>
                      <button onClick={applyCode} disabled={code === draft.html} className="h-8 px-3 rounded-[8px] bg-[#2F6BFF] text-white text-xs disabled:opacity-50">应用代码</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col md:flex-row min-h-0">
                  <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[#E5E7EB] overflow-y-auto p-3 flex flex-col gap-2 max-h-48 md:max-h-none">
                    {!draft.id && <p className="text-sm text-[#6B7280]">保存项目后，每次保存都会生成一个版本。</p>}
                    {draft.id && versions.length === 0 && <p className="text-sm text-[#6B7280]">暂无历史版本。</p>}
                    {versions.map((v) => (
                      <div key={v.id} className={`rounded-[10px] border p-2 text-xs ${compareId === v.id ? 'border-[#2F6BFF] bg-[#EEF3FF]' : 'border-[#E5E7EB]'}`}>
                        <div className="font-medium text-sm">第 {v.revision} 版{v.revision === draft.revision ? '（当前）' : ''}</div>
                        <div className="text-[#6B7280] truncate" title={v.prompt}>{v.prompt}</div>
                        {v.created_at && <div className="text-[#9CA3AF]">{new Date(v.created_at).toLocaleString('zh-CN')}</div>}
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => setCompareId(v.id)} className="text-[#2F6BFF] underline">对比</button>
                          <button onClick={() => restore(v)} disabled={busy || saving} className="text-[#2F6BFF] underline">恢复此版</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto bg-[#0F172A] font-mono text-xs leading-5">
                    {!compare ? (
                      <p className="p-4 text-[#94A3B8]">选择一个版本点击"对比"，查看它和当前代码的差异。</p>
                    ) : !diff ? (
                      <p className="p-4 text-[#94A3B8]">代码过长，无法逐行对比。</p>
                    ) : (
                      <>
                        <div className="sticky top-0 px-3 py-1 bg-[#1E293B] text-[#CBD5E1]">第 {compare.revision} 版 → 当前代码（<span className="text-[#86EFAC]">+{diff.filter((d) => d.type === 'add').length}</span> / <span className="text-[#FCA5A5]">-{diff.filter((d) => d.type === 'del').length}</span>）</div>
                        {diff.map((l, i) => (
                          <div key={i} className={`px-3 whitespace-pre-wrap break-all ${l.type === 'add' ? 'bg-[#14532D]/60 text-[#BBF7D0]' : l.type === 'del' ? 'bg-[#7F1D1D]/60 text-[#FECACA]' : 'text-[#94A3B8]'}`}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text}</div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
              {busy && draft && tab === 'preview' && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center gap-2 text-sm text-[#2F6BFF]"><Loader2 className="w-5 h-5 animate-spin" />{STAGES[stage]}中…（{elapsed} 秒）</div>
              )}
            </div>
          </div>
        </main>
      </div>

      <Dialog open={pwdOpen} onOpenChange={(o) => { if (!pwdBusy) setPwdOpen(o); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>新密码需 8—64 位，并同时包含字母和数字。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {([['old', '当前密码', 'current-password'], ['next', '新密码', 'new-password'], ['confirm', '确认新密码', 'new-password']] as const).map(([k, label, ac]) => (
              <label key={k} className="flex flex-col gap-1 text-sm">
                {label}
                <input type="password" autoComplete={ac} value={pwd[k]} onChange={(e) => setPwd((v) => ({ ...v, [k]: e.target.value }))}
                  className="h-10 rounded-[10px] border border-[#E5E7EB] px-3 focus:outline-none focus:border-[#2F6BFF]" />
              </label>
            ))}
            {pwdError && <p role="alert" className="text-sm text-[#DC2626]">{pwdError}</p>}
          </div>
          <DialogFooter>
            <button onClick={() => setPwdOpen(false)} disabled={pwdBusy} className="h-10 px-4 rounded-[10px] border border-[#E5E7EB] text-sm !bg-white">取消</button>
            <button onClick={changePassword} disabled={pwdBusy} className="h-10 px-4 rounded-[10px] bg-[#2F6BFF] text-white text-sm flex items-center gap-1 disabled:opacity-60">{pwdBusy && <Loader2 className="w-4 h-4 animate-spin" />}确认修改</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delOpen} onOpenChange={(o) => { if (!delBusy) setDelOpen(o); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>注销账号</DialogTitle>
            <DialogDescription>将永久删除你的全部项目、历史版本和分享链接{isEmail ? '，以及这个邮箱账号本身' : '（平台账号本身不会被删除）'}，无法恢复。建议先点"备份"导出项目。</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            请输入“注销”确认
            <input value={delText} onChange={(e) => setDelText(e.target.value)} className="h-10 rounded-[10px] border border-[#E5E7EB] px-3 focus:outline-none focus:border-[#DC2626]" />
          </label>
          <DialogFooter>
            <button onClick={() => setDelOpen(false)} disabled={delBusy} className="h-10 px-4 rounded-[10px] border border-[#E5E7EB] text-sm !bg-white">取消</button>
            <button onClick={deleteAccount} disabled={delBusy || delText !== '注销'} className="h-10 px-4 rounded-[10px] bg-[#DC2626] text-white text-sm flex items-center gap-1 disabled:opacity-50">{delBusy && <Loader2 className="w-4 h-4 animate-spin" />}永久删除</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
