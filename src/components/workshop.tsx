"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  FileCode2,
  FolderOpen,
  Layers3,
  Loader2,
  LogOut,
  Monitor,
  Plus,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { api, HttpError } from "@/lib/client";
import { length, loginSchema, registerSchema } from "@/lib/validation";
import type {
  Candidate,
  GenerationResult,
  Project,
  ProjectSummary,
} from "@/lib/types";
import Preview from "./preview";

type User = { id: string; email: string };
type Setup = { auth: boolean; model: boolean; guest?: boolean };
type Session = { user: User | null; setup: Setup };

async function openSession(): Promise<Session> {
  const data = await api<Session>("/api/session");
  if (!data.setup.guest || data.user) return data;
  const initialize = async () => {
    // Recheck inside the browser lock so first-load tabs share one workspace.
    let current = await api<Session>("/api/session");
    if (!current.user) {
      await api("/api/auth/guest", { method: "POST" });
      current = await api<Session>("/api/session");
      if (!current.user)
        throw new Error("无法保存访客身份，请允许本站使用 Cookie 后重新加载。");
    }
    return current;
  };
  return navigator.locks
    ? navigator.locks.request("xiaoyan-guest-init", initialize)
    : initialize();
}
const examples = [
  {
    label: "待办清单",
    icon: CheckCircle2,
    prompt:
      "制作一个待办清单，支持新增事项、标记完成、删除事项、显示未完成数量，并阻止添加空内容。使用清爽的中文界面。",
  },
  {
    label: "计算器",
    icon: Braces,
    prompt:
      "制作一个简单计算器，支持加减乘除、小数、清空和除零提示，按钮和键盘都可以输入。",
  },
  {
    label: "番茄钟",
    icon: Clock3,
    prompt:
      "制作一个番茄钟，默认 25 分钟，允许设置 1—60 分钟，支持开始、暂停、继续和重置，显示剩余时间。",
  },
];
const pendingKey = (id: string) => `xiaoyan-pending-${id}`;

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <span className="brand-mark">
        <Layers3 size={22} strokeWidth={2.5} />
      </span>
      <span>
        小验工坊<small>IDEA TO APP</small>
      </span>
    </div>
  );
}

function Auth({
  setup,
  onLogin,
  notice,
}: {
  setup: Setup;
  onLogin: (user: User) => void;
  notice?: string;
}) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const result = (register ? registerSchema : loginSchema).safeParse({
      email,
      password,
      confirmPassword: confirm,
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user: User }>(
        `/api/auth/${register ? "register" : "login"}`,
        { method: "POST", body: JSON.stringify(result.data) },
      );
      onLogin(data.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      setPassword("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-main">
          <span className="eyebrow">
            <span className="orange-dot" /> YOUR NEXT IDEA STARTS HERE
          </span>
          <h1>
            一个想法，
            <br />
            一个<span>能用的应用。</span>
          </h1>
          <p className="story-description">
            把需求说清楚，把创意交给 AI。
            <br />
            从第一行描述，到第一次亲手体验。
          </p>
          <div className="story-demo">
            <div className="mini-top">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>想法正在发生</span>
              <Sparkles size={15} />
            </div>
            <div className="mini-prompt">
              <WandSparkles size={18} />
              <span>“帮我做一个简洁的待办清单”</span>
            </div>
            <div className="mini-app">
              <div>
                <span className="eyebrow">MY LITTLE PLAN</span>
                <h3>把今天，过得有条理。</h3>
              </div>
              <div className="mini-task done">
                <Check size={15} />
                <span>写下一个新想法</span>
              </div>
              <div className="mini-task">
                <Circle size={15} />
                <span>把它变成小应用</span>
              </div>
              <div className="mini-task">
                <Circle size={15} />
                <span>亲手试一试</span>
              </div>
            </div>
            <div className="mini-label">
              <span />
              交互示意 · 登录后开始真实生成
            </div>
          </div>
        </div>
        <div className="story-footer">
          <span>DESCRIBE. BUILD. TRY.</span>
          <span>
            轻量应用，从这里开始 <ArrowUpRight size={14} />
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="pill">
            <Sparkles size={13} /> ATOMS DEMO
          </span>
          <h2>{register ? "开启你的创造之旅" : "欢迎回到工坊"}</h2>
          <p className="muted">
            {register
              ? "创建账号，保存每一个值得实现的想法。"
              : "登录后，继续把想法变成可以体验的作品。"}
          </p>
          <div className="auth-tabs">
            <button
              disabled={busy}
              className={!register ? "active" : ""}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              登录
            </button>
            <button
              disabled={busy}
              className={register ? "active" : ""}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              注册账号
            </button>
          </div>
          {!setup.auth && (
            <div className="notice warning" role="status">
              账号服务尚未配置。请按项目 README 配置 Supabase 后开始使用。
            </div>
          )}
          {notice && (
            <div className="notice warning" role="status">
              {notice}
            </div>
          )}
          <form onSubmit={submit} noValidate>
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <label htmlFor="password">
              密码{register && <small>8—64 个字符，包含字母和数字</small>}
            </label>
            <input
              id="password"
              aria-label="密码"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={register ? "设置你的密码" : "输入密码"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            {register && (
              <>
                <label htmlFor="confirm">确认密码</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="primary auth-submit"
              disabled={busy || !setup.auth}
            >
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <>
                  {register ? "创建账号并开始" : "进入工坊"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <p className="auth-note">
            <ShieldCheck size={16} />
            {register
              ? "Demo 暂不验证邮箱，请使用测试邮箱和独立密码。"
              : "你的项目按账号保存，重新登录后可以继续打开。"}
          </p>
        </div>
        <div className="auth-bottom">
          一个小而完整的 AI 应用工坊 <span>✦</span>
        </div>
      </section>
    </main>
  );
}

export default function Workshop() {
  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState<Setup>({ auth: false, model: false });
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const epoch = useRef(0);
  const working = useRef(false);
  const bootRequest = useRef<Promise<Session> | null>(null);
  const current = candidate ?? project;

  const setPending = useCallback((id: string | null, owner: string) => {
    setPendingId(id);
    try {
      if (id) sessionStorage.setItem(pendingKey(owner), id);
      else sessionStorage.removeItem(pendingKey(owner));
    } catch {
      /* storage disabled: in-memory recovery remains available */
    }
  }, []);

  const failure = useCallback((e: unknown) => {
    if (e instanceof HttpError && e.status === 401) {
      epoch.current++;
      setUser(null);
      setProject(null);
      setCandidate(null);
      setProjects([]);
      setPrompt("");
      setPendingId(null);
      setUncertain(false);
    }
    setError(e instanceof Error ? e.message : "操作失败，请重试");
  }, []);
  const loadProjects = useCallback(async () => {
    const mark = epoch.current;
    try {
      const data = await api<{ projects: ProjectSummary[] }>("/api/projects");
      if (mark === epoch.current) setProjects(data.projects);
    } catch (e) {
      if (mark === epoch.current) failure(e);
    }
  }, [failure]);
  const boot = useCallback(async () => {
    setBooting(true);
    setBootError("");
    try {
      bootRequest.current ??= openSession();
      const data = await bootRequest.current;
      setUser(data.user);
      setSetup(data.setup);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : "加载失败");
    } finally {
      bootRequest.current = null;
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    if (!user) return;
    void loadProjects();
    try {
      const id = sessionStorage.getItem(pendingKey(user.id));
      if (id) {
        setPendingId(id);
        setUncertain(true);
        setMessage("发现尚未确认的操作，请先检查状态。");
      }
    } catch {
      /* optional storage */
    }
  }, [user, loadProjects]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (candidate || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [candidate, busy]);

  function discardAllowed() {
    return (
      !candidate ||
      window.confirm("当前结果尚未保存，离开后可能丢失。确定继续吗？")
    );
  }
  function reset() {
    setProject(null);
    setCandidate(null);
    setPrompt("");
    setError("");
    setMessage("");
    setTab("preview");
  }
  async function openProject(id: string) {
    if (working.current || !discardAllowed()) return;
    working.current = true;
    setBusy("正在打开项目");
    const mark = epoch.current;
    setError("");
    try {
      const data = await api<{ project: Project }>(`/api/projects/${id}`);
      if (mark !== epoch.current) return;
      setProject(data.project);
      setCandidate(null);
      if (user) setPending(null, user.id);
      setPrompt("");
      setMessage("项目已恢复");
      setShowProjects(false);
      setTab("preview");
    } catch (e) {
      failure(e);
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!user || working.current || uncertain || candidate) return;
    if (!prompt.trim()) {
      setError("请输入有效需求");
      return;
    }
    if (length(prompt.trim()) > 2000) {
      setError("需求最多 2,000 字符");
      return;
    }
    working.current = true;
    const mark = epoch.current;
    const owner = user.id;
    const id = crypto.randomUUID();
    setPending(id, owner);
    setError("");
    setMessage("");
    setBusy(project ? "正在修改应用" : "正在生成应用");
    try {
      const result = await api<GenerationResult>(
        "/api/generate",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            projectId: project?.id ?? crypto.randomUUID(),
            prompt: prompt.trim(),
            revision: project?.revision ?? 0,
          }),
        },
        90000,
      );
      if (mark !== epoch.current) return;
      if (result.saved && result.project) {
        setProject(result.project);
        setCandidate(null);
        setPending(null, owner);
        setPrompt("");
        setMessage("生成完成，项目已保存");
        void loadProjects();
      } else if (result.candidate) {
        setCandidate(result.candidate);
        setError(`生成完成，但保存失败：${result.message || "请重试保存"}`);
      } else {
        setUncertain(true);
        setMessage("返回结果需要确认，请检查操作状态");
      }
      setTab("preview");
    } catch (e) {
      if (mark !== epoch.current) return;
      failure(e);
      if (
        e instanceof HttpError &&
        (e.code === "NETWORK_UNKNOWN" ||
          e.code === "REQUEST_EXISTS" ||
          e.code === "UNEXPECTED")
      )
        setUncertain(true);
      else setPending(null, owner);
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  async function retrySave() {
    if (!user || !candidate || !pendingId || working.current) return;
    working.current = true;
    setBusy("正在保存");
    setError("");
    const mark = epoch.current;
    try {
      const result = await api<{ project: Project }>(
        `/api/projects/${candidate.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ requestId: pendingId, html: candidate.html }),
        },
      );
      if (mark !== epoch.current) return;
      setProject(result.project);
      setCandidate(null);
      setPrompt("");
      setPending(null, user.id);
      setUncertain(false);
      setMessage("项目已保存");
      void loadProjects();
    } catch (e) {
      failure(e);
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  async function checkStatus() {
    if (!user || !pendingId || working.current) return;
    working.current = true;
    setBusy("正在检查状态");
    setError("");
    const mark = epoch.current;
    try {
      const result = await api<{ status: string; project?: Project }>(
        `/api/requests/${pendingId}`,
      );
      if (mark !== epoch.current) return;
      if (result.status === "running") {
        setMessage("服务端仍在处理中，请稍后再次检查");
        return;
      }
      if (result.project) {
        setProject(result.project);
        setCandidate(null);
        setPrompt("");
        setMessage("操作已完成，已恢复保存结果");
        void loadProjects();
      } else
        setMessage(
          result.status === "unsaved"
            ? "生成结果未保存；若当前预览仍在，可重试保存。"
            : "该操作未成功保存，可以手动重新生成。",
        );
      setUncertain(false);
      if (!candidate || result.project) setPending(null, user.id);
    } catch (e) {
      failure(e);
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  async function logout() {
    if (working.current || !discardAllowed()) return;
    working.current = true;
    setBusy("正在退出");
    try {
      await api("/api/auth/logout", { method: "POST" });
      epoch.current++;
      setUser(null);
      setProjects([]);
      reset();
      setPendingId(null);
      setUncertain(false);
    } catch (e) {
      failure(e);
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  if (booting)
    return (
      <main className="loading">
        <Brand />
        <Loader2 size={24} className="spin" />
        <p>正在打开工坊…</p>
      </main>
    );
  if (bootError)
    return (
      <main className="loading">
        <Brand />
        <p role="alert">{bootError}</p>
        <button className="primary" onClick={() => void boot()}>
          重新加载
        </button>
      </main>
    );
  if (!user && setup.guest)
    return (
      <main className="loading">
        <Brand />
        <p role="alert">
          访客会话已失效，请重新打开工坊。清除 Cookie 后无法恢复原访客项目。
        </p>
        <button className="primary" onClick={() => void boot()}>
          重新打开工坊
        </button>
      </main>
    );
  if (!user)
    return (
      <Auth
        setup={setup}
        notice={error}
        onLogin={(u) => {
          epoch.current++;
          setError("");
          setUser(u);
        }}
      />
    );
  return (
    <div className="workspace">
      <aside className="rail">
        <Brand light />
        <button
          className="rail-new"
          disabled={!!busy || uncertain}
          onClick={() => {
            if (discardAllowed()) {
              reset();
              setPending(null, user.id);
            }
          }}
        >
          <Plus size={17} />
          新建项目<span>＋</span>
        </button>
        <div className="rail-heading">
          <span>我的项目</span>
          <span>{projects.length}</span>
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="no-projects">
              <FolderOpen size={24} />
              <p>
                每个好想法
                <br />
                都会保存在这里
              </p>
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                className={`project-item ${current?.id === p.id ? "selected" : ""}`}
                disabled={!!busy || uncertain}
                onClick={() => void openProject(p.id)}
              >
                <FileCode2 size={15} />
                <span>
                  {p.name}
                  <small>
                    {new Date(p.updated_at).toLocaleDateString("zh-CN")}
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))
          )}
        </div>
        <div className="rail-tip">
          <ShieldCheck size={16} />
          <span>
            {setup.guest ? "免登录，项目自动保存。" : "你的创作，按账号保存。"}
            <br />
            {setup.guest
              ? "请保留当前浏览器的 Cookie。"
              : "随时回来，继续实现。"}
          </span>
        </div>
        <div className="rail-user">
          <span className="avatar">
            {setup.guest ? "访" : user.email[0]?.toUpperCase()}
          </span>
          <span
            title={
              setup.guest
                ? "项目保存在本机；换浏览器或清除 Cookie 后无法恢复访客项目"
                : user.email
            }
          >
            {setup.guest ? "本机工作空间" : user.email}
          </span>
          {!setup.guest && (
            <button
              aria-label="退出登录"
              title="退出登录"
              disabled={!!busy}
              onClick={() => void logout()}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="breadcrumb">工作台</span>
            <ChevronRight size={13} />
            <strong>{current?.name ?? "新的想法"}</strong>
          </div>
          <span className="header-badge">
            <span className="orange-dot" /> AI 应用工坊
          </span>
          <button
            className="mobile-projects text-button"
            onClick={() => setShowProjects(!showProjects)}
          >
            <FolderOpen size={16} />
            项目
          </button>
        </header>
        {showProjects && (
          <div className="mobile-project-menu">
            <button
              disabled={!!busy || uncertain}
              onClick={() => {
                if (discardAllowed()) {
                  reset();
                  setPending(null, user.id);
                  setShowProjects(false);
                }
              }}
            >
              新建项目
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                disabled={!!busy || uncertain}
                onClick={() => void openProject(p.id)}
              >
                {p.name}
              </button>
            ))}
            {!setup.guest && (
              <button disabled={!!busy} onClick={() => void logout()}>
                退出登录
              </button>
            )}
          </div>
        )}
        <div className="workspace-title">
          <div>
            <span className="eyebrow">YOUR CREATIVE SPACE</span>
            <h1>{current ? "让想法，再好一点。" : "今天，想做点什么？"}</h1>
            <p>
              {current
                ? "体验你的应用，补充要求，继续打磨。"
                : "描述一个小想法，我们一起把它做出来。"}
            </p>
          </div>
          <span className="step-caption">
            01 描述 <ChevronRight size={12} /> 02 生成{" "}
            <ChevronRight size={12} /> 03 体验
          </span>
        </div>
        {!setup.model && (
          <div className="notice warning setup-notice">
            模型服务尚未配置，生成暂不可用。请按 README 填写服务端模型配置。
          </div>
        )}
        <div className="studio-grid">
          <section className="compose-panel">
            <div className="panel-heading">
              <span>
                <WandSparkles size={17} />
                {project || candidate ? "继续打磨" : "描述你的想法"}
              </span>
              <span className="tag">AI BUILDER</span>
            </div>
            {current && (
              <div className="original-prompt">
                <span>最初的想法</span>
                <p>{current.original_prompt}</p>
                {current.applied_changes.length > 0 && (
                  <small>
                    已应用 {current.applied_changes.length} 次补充要求
                  </small>
                )}
              </div>
            )}
            <form onSubmit={generate} className="compose-form">
              <label htmlFor="prompt">
                {current ? "这次想改些什么？" : "你希望应用可以做什么？"}
              </label>
              <div className="textarea-wrap">
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={!!busy || uncertain || !!candidate}
                  placeholder={
                    current
                      ? "例如：增加已完成 / 未完成筛选，保留原有功能…"
                      : "例如：做一个待办清单，可以新增事项、标记完成，并统计剩余任务…"
                  }
                />
                <span
                  className={length(prompt.trim()) > 2000 ? "over-limit" : ""}
                >
                  {length(prompt.trim())} / 2,000
                </span>
              </div>
              {!current && (
                <>
                  <div className="example-label">
                    还没想好？从一个小工具开始
                  </div>
                  <div className="examples">
                    {examples.map(({ label, icon: Icon, prompt: text }) => (
                      <button
                        type="button"
                        disabled={!!busy || uncertain}
                        key={label}
                        onClick={() => {
                          setPrompt(text);
                          setError("");
                        }}
                      >
                        <Icon size={14} />
                        {label}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                type="submit"
                className="primary generate-button"
                disabled={!!busy || uncertain || !!candidate || !setup.model}
              >
                {busy ? (
                  <>
                    <Loader2 size={17} className="spin" />
                    {busy}
                  </>
                ) : (
                  <>
                    <Sparkles size={17} />
                    {current ? "根据要求修改" : "生成应用"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
            <div aria-live="polite" className="status-area">
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              {message && <div className="notice info">{message}</div>}
              {busy && (
                <p className="processing">
                  <span className="pulse-dot" />
                  {busy}，请稍候，不必重复点击。
                </p>
              )}
              {candidate && (
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void retrySave()}
                >
                  重试保存（不重新生成）
                </button>
              )}
              {uncertain && (
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void checkStatus()}
                >
                  检查操作状态
                </button>
              )}
            </div>
            <div className="compose-footer">
              <ShieldCheck size={15} />
              <span>
                适合待办、计时器、计算器等单页工具。
                <br />
                暂不支持支付、复杂后台或第三方服务。
              </span>
            </div>
          </section>
          <section className="result-panel">
            <div className="result-tabs">
              <div role="tablist" aria-label="结果视图">
                <button
                  role="tab"
                  aria-selected={tab === "preview"}
                  className={tab === "preview" ? "active" : ""}
                  onClick={() => setTab("preview")}
                >
                  <Monitor size={15} />
                  应用预览
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "code"}
                  className={tab === "code" ? "active" : ""}
                  onClick={() => setTab("code")}
                >
                  <Code2 size={15} />
                  查看代码
                </button>
              </div>
              {current && (
                <span className={`save-badge ${candidate ? "unsaved" : ""}`}>
                  {candidate ? (
                    <Circle size={12} />
                  ) : (
                    <CheckCircle2 size={12} />
                  )}
                  {candidate ? "未保存" : "已保存"}
                </span>
              )}
            </div>
            {!current ? (
              <div className="empty-preview">
                <div className="empty-art">
                  <div className="art-grid" />
                  <span className="art-code">
                    <Code2 size={38} />
                  </span>
                  <span className="art-spark">
                    <Sparkles size={22} />
                  </span>
                  <span className="art-chip">
                    <span /> READY TO CREATE
                  </span>
                </div>
                <h2>你的下一个作品，在这里发生</h2>
                <p>
                  在左侧写下需求，点击生成。
                  <br />
                  几句话，让一个小应用开始运转。
                </p>
                <div className="empty-features">
                  <span>
                    <Monitor size={14} />
                    即时预览
                  </span>
                  <span>
                    <Code2 size={14} />
                    真实代码
                  </span>
                  <span>
                    <CheckCircle2 size={14} />
                    自动保存
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="preview-tab" hidden={tab !== "preview"}>
                  <Preview html={current.html} />
                </div>
                <pre
                  hidden={tab !== "code"}
                  className="code-view"
                  tabIndex={0}
                  aria-label="生成的 HTML 代码"
                >
                  <code>{current.html}</code>
                </pre>
              </>
            )}
          </section>
        </div>
        <footer className="workspace-footer">
          <span>小步创造，每个想法都值得试一试。</span>
          <span>生成完成 ≠ 功能已验收，请亲手体验你的应用。</span>
        </footer>
      </div>
    </div>
  );
}
