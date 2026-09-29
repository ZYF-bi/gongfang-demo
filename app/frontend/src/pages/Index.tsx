import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2, LogIn, LogOut, Sparkles, UserRound, RotateCcw, FolderOpen, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  client, MODEL, MAX_PROMPT, SYSTEM, buildUserMessage, validateHtml, buildPreview,
  parseChanges, errorText, type Draft, type Project,
} from '@/lib/workshop';

type Auth = 'loading' | 'in' | 'out';
const EXAMPLES = ['番茄钟计时器，可设置时长', '记账小工具，按类别汇总', '随机抽签器，输入名单抽取'];
const MIN_RATIO = 1 / 3;
const MAX_RATIO = 2 / 3;

export default function Index() {
  const [auth, setAuth] = useState<Auth>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [ratio, setRatio] = useState(0.38);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const channel = useMemo(() => Math.random().toString(36).slice(2), []);

  const loadProjects = useCallback(async () => {
    try {
      const r = await client.entities.projects.query({ query: {}, sort: '-updated_at', limit: 50 });
      setProjects(r.data?.items || []);
    } catch (e) {
      toast.error('加载项目失败：' + errorText(e));
    }
  }, []);

  useEffect(() => {
    client.auth.me()
      .then((r) => { if (r?.data) { setAuth('in'); loadProjects(); } else setAuth('out'); })
      .catch(() => setAuth('out'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; channel?: string; message?: string };
      if (d?.type === 'preview-error' && d.channel === channel && typeof d.message === 'string') setPreviewError(d.message);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [channel]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (!box) return;
      const r = (e.clientX - box.left) / box.width;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)));
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging]);

  const srcDoc = useMemo(() => (draft ? buildPreview(draft.html, channel) : ''), [draft, channel]);

  const generate = async (text = prompt) => {
    if (auth !== 'in') return client.auth.toLogin();
    const p = text.trim();
    if (!p) return setError('请输入有效需求');
    if ([...p].length > MAX_PROMPT) return setError('需求最多 2,000 字符');
    setBusy(true); setError(''); setLastPrompt(p);
    try {
      const r = await client.apiCall.invoke({
        url: '/api/v1/workshop/generate',
        method: 'POST',
        data: { model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserMessage(p, draft ?? undefined) }] },
        options: { timeout: 600_000 },
      });
      const html = validateHtml(String(r?.data?.content ?? ''));
      setPreviewError('');
      setDraft((d) => d
        ? { ...d, html, changes: [...d.changes, p] }
        : { name: p.slice(0, 20), original_prompt: p, changes: [], html, revision: 0 });
      setDirty(true); setPrompt('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (auth !== 'in') return client.auth.toLogin();
    setSaving(true);
    try {
      const data = { name: draft.name, original_prompt: draft.original_prompt, applied_changes: JSON.stringify(draft.changes), html: draft.html, revision: draft.revision + 1 };
      const r = draft.id
        ? await client.entities.projects.update({ id: String(draft.id), data })
        : await client.entities.projects.create({ data });
      setDraft({ ...draft, id: r.data.id, revision: data.revision });
      setDirty(false);
      toast.success('项目已保存');
      loadProjects();
    } catch (e) {
      toast.error('保存失败：' + errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const open = (p: Project) => {
    if (dirty && !confirm('当前修改未保存，确定切换吗？')) return;
    setDraft({ id: p.id, name: p.name, original_prompt: p.original_prompt, changes: parseChanges(p.applied_changes), html: p.html, revision: p.revision });
    setDirty(false); setError(''); setPreviewError('');
  };

  const remove = async (p: Project) => {
    if (!confirm(`确定删除「${p.name}」吗？`)) return;
    try {
      await client.entities.projects.delete({ id: String(p.id) });
      if (draft?.id === p.id) { setDraft(null); setDirty(false); }
      loadProjects();
    } catch (e) {
      toast.error('删除失败：' + errorText(e));
    }
  };

  const logout = async () => {
    if (dirty && !confirm('当前修改未保存，确定退出登录吗？')) return;
    try {
      await client.auth.logout();
    } catch {
      /* 本地凭证已清除，忽略服务端退出失败 */
    }
    setAuth('out'); setProjects([]); setDraft(null); setDirty(false);
    toast.success('已退出登录');
    setTimeout(() => window.location.replace('/'), 300);
  };

  const reset = () => {
    if (dirty && !confirm('当前修改未保存，确定新建吗？')) return;
    setDraft(null); setDirty(false); setPrompt(''); setError(''); setPreviewError('');
  };

  const card = 'bg-white border border-[#E5E7EB] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)]';
  const primaryBtn = 'h-10 rounded-[10px] bg-[#2F6BFF] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#2459DB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-[#F7F8FA] text-[#111827]" style={{ fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
      <header className="h-14 shrink-0 bg-white border-b border-[#E5E7EB] px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-[#2F6BFF] text-white flex items-center justify-center"><Wand2 className="w-4 h-4" /></span>
          <span className="text-lg font-semibold">小验工坊</span>
          <span className="hidden sm:inline text-xs text-[#6B7280] ml-2">一句话生成可运行网页</span>
        </div>
        {auth === 'in' ? (
          <div className="flex items-center gap-1">
            <span className="w-8 h-8 rounded-full bg-[#EEF3FF] text-[#2F6BFF] flex items-center justify-center"><UserRound className="w-4 h-4" aria-hidden /></span>
            <button aria-label="退出登录" onClick={logout} title="退出登录" className="p-2 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]"><LogOut className="w-4 h-4" /></button>
          </div>
        ) : auth === 'out' ? (
          <button onClick={() => client.auth.toLogin()} className="h-9 px-4 rounded-[10px] bg-[#2F6BFF] text-white text-sm flex items-center gap-1 hover:bg-[#2459DB]"><LogIn className="w-4 h-4" />登录</button>
        ) : null}
      </header>

      <div ref={splitRef} className={`flex-1 min-h-0 flex flex-col md:flex-row ${dragging ? 'select-none cursor-col-resize' : ''}`}>
        <aside className="md:h-full md:overflow-y-auto p-4 flex flex-col gap-4 md:[width:var(--left)] shrink-0" style={{ ['--left' as string]: `${ratio * 100}%` }}>
          <section className={`${card} p-4 flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{draft ? '继续修改' : '描述你想要的网页'}</h2>
              {draft && <button onClick={reset} className="text-xs flex items-center gap-1 text-[#6B7280] hover:text-[#2F6BFF]"><Plus className="w-3 h-3" />新建</button>}
            </div>
            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} rows={5}
              placeholder={draft ? '例如：把按钮改成绿色，并增加重置功能' : '例如：一个番茄钟计时器，可设置时长'}
              className="w-full rounded-[10px] bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/40 focus:border-[#2F6BFF] resize-none"
            />
            {!draft && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => <button key={ex} onClick={() => setPrompt(ex)} className="text-xs px-2.5 py-1.5 rounded-full bg-[#F3F4F6] text-[#374151] hover:bg-[#EEF3FF] hover:text-[#2F6BFF]">{ex}</button>)}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-[#6B7280]">
              <span>{[...prompt].length} / {MAX_PROMPT}</span>
              <span>模型：{MODEL}</span>
            </div>
            {auth === 'out' ? (
              <button onClick={() => client.auth.toLogin()} className={primaryBtn}><LogIn className="w-4 h-4" />登录后生成</button>
            ) : (
              <button onClick={() => generate()} disabled={busy || auth !== 'in' || !prompt.trim()} className={primaryBtn}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" />生成中…（约 1–2 分钟）</> : <><Sparkles className="w-4 h-4" />{draft ? '应用修改' : '生成网页'}</>}
              </button>
            )}
            {error && (
              <div className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] p-3 text-sm text-[#DC2626]">
                {error}
                {lastPrompt && !busy && <button onClick={() => generate(lastPrompt)} className="ml-2 underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />重试</button>}
              </div>
            )}
          </section>

          {draft && (
            <section className={`${card} p-4 text-sm flex flex-col gap-2`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold truncate">{draft.name}</h2>
                <button onClick={save} disabled={saving || (!dirty && !!draft.id)} className="h-9 px-3 rounded-[10px] border border-[#2F6BFF] text-[#2F6BFF] !bg-transparent hover:!bg-[#EEF3FF] flex items-center gap-1 disabled:opacity-50 shrink-0">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{dirty || !draft.id ? '保存' : '已保存'}
                </button>
              </div>
              <p className="text-[#6B7280]">原始需求：{draft.original_prompt}</p>
              {draft.changes.length > 0 && (
                <ol className="list-decimal pl-5 text-[#374151] space-y-1">{draft.changes.map((c, i) => <li key={i}>{c}</li>)}</ol>
              )}
            </section>
          )}

          <section className={`${card} p-4 flex flex-col gap-2`}>
            <h2 className="font-semibold text-sm flex items-center gap-2"><FolderOpen className="w-4 h-4 text-[#6B7280]" />我的项目</h2>
            {auth === 'out' && <p className="text-sm text-[#6B7280]">登录后可生成、保存和查看项目。</p>}
            {auth === 'in' && projects.length === 0 && <p className="text-sm text-[#6B7280]">还没有保存的项目。</p>}
            {projects.map((p) => (
              <div key={p.id} className={`flex items-center rounded-[10px] border ${draft?.id === p.id ? 'border-[#2F6BFF] bg-[#EEF3FF]' : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'}`}>
                <button onClick={() => open(p)} className="flex-1 min-w-0 text-left px-3 py-2 text-sm">
                  <div className="truncate">{p.name}</div>
                  <div className="text-xs text-[#6B7280]">第 {p.revision} 版{p.updated_at ? ' · ' + new Date(p.updated_at).toLocaleString('zh-CN') : ''}</div>
                </button>
                <button aria-label={`删除 ${p.name}`} onClick={() => remove(p)} className="p-3 text-[#9CA3AF] hover:text-[#DC2626]"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
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

        <main className="flex-1 min-w-0 min-h-0 p-4 md:pl-2 flex flex-col gap-3 h-[85vh] md:h-full">
          {previewError && <div className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-sm text-[#DC2626]">预览运行出错：{previewError}（可在左侧描述问题让 AI 修复）</div>}
          <div className={`${card} flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className="h-10 shrink-0 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 flex items-center gap-3">
              <div className="flex gap-1.5"><span className="w-3 h-3 rounded-full bg-[#FCA5A5]" /><span className="w-3 h-3 rounded-full bg-[#FCD34D]" /><span className="w-3 h-3 rounded-full bg-[#86EFAC]" /></div>
              <span className="text-xs text-[#6B7280] truncate">{draft ? `${draft.name} · 预览` : '预览'}</span>
            </div>
            <div className="relative flex-1 min-h-0">
              {draft ? (
                <iframe title="网页预览" sandbox="allow-scripts" srcDoc={srcDoc} className={`block w-full h-full border-0 ${dragging ? 'pointer-events-none' : ''}`} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="w-14 h-14 rounded-2xl bg-[#EEF3FF] text-[#2F6BFF] flex items-center justify-center">
                    {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Sparkles className="w-7 h-7" />}
                  </span>
                  <h2 className="text-lg font-semibold">{busy ? 'AI 正在搭建你的网页…' : '一句话，生成一个可运行的网页'}</h2>
                  <p className="text-sm text-[#6B7280] max-w-sm">{busy ? '通常需要 1–2 分钟，请稍候。' : '在左侧描述需求，生成后可在这里预览，并继续提出修改。'}</p>
                </div>
              )}
              {busy && draft && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center gap-2 text-sm text-[#2F6BFF]"><Loader2 className="w-5 h-5 animate-spin" />正在应用修改…</div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
