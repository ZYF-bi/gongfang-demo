import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Wand2, Mail, ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { client, applyEmailToken, errorText } from '@/lib/workshop';

type Mode = 'login' | 'register';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STRENGTH = [
  { label: '弱', color: '#DC2626' },
  { label: '一般', color: '#F59E0B' },
  { label: '较强', color: '#2F6BFF' },
  { label: '强', color: '#16A34A' },
];

function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (pw.length >= 12) s++;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s++;
  return s;
}

function validate(mode: Mode, email: string, pw: string, pw2: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!EMAIL_RE.test(email.trim())) e.email = '请输入有效邮箱';
  if (mode === 'login') {
    if (!pw) e.password = '请输入密码';
    return e;
  }
  if (pw.length < 8 || pw.length > 64) e.password = '密码需要 8—64 个字符';
  else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) e.password = '密码须包含字母和数字';
  if (pw !== pw2) e.confirm = '两次密码不一致';
  return e;
}

export default function Login() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'in' | 'out'>('checking');
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const strength = passwordStrength(password);

  useEffect(() => {
    client.auth.me().then((r) => setStatus(r?.data ? 'in' : 'out')).catch(() => setStatus('out'));
  }, []);

  const switchMode = (m: Mode) => { setMode(m); setErrors({}); setServerError(''); setConfirm(''); };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = validate(mode, email, password, confirm);
    setErrors(errs); setServerError('');
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      const r = await client.apiCall.invoke({
        url: `/api/v1/email_auth/${mode}`,
        method: 'POST',
        data: mode === 'login'
          ? { email: email.trim(), password }
          : { email: email.trim(), password, confirm_password: confirm },
      });
      if (!r?.data?.token) throw new Error('登录失败，请重试');
      applyEmailToken(r.data.token);
      window.location.href = '/';
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const input = (err?: string) =>
    `w-full h-11 rounded-[10px] border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/30 ${err ? 'border-[#DC2626]' : 'border-[#E5E7EB] focus:border-[#2F6BFF]'}`;

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-4 text-[#111827]" style={{ fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
      <div className="w-full max-w-[420px]">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#2F6BFF] mb-4"><ArrowLeft className="w-4 h-4" />返回工坊</Link>
        <div className="bg-white border border-[#E5E7EB] rounded-[16px] shadow-[0_4px_24px_rgba(16,24,40,.06)] p-7">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-9 h-9 rounded-lg bg-[#2F6BFF] text-white flex items-center justify-center"><Wand2 className="w-5 h-5" /></span>
            <h1 className="text-xl font-semibold">{mode === 'login' ? '登录小验工坊' : '注册小验工坊'}</h1>
          </div>
          <p className="text-sm text-[#6B7280] mb-5">登录后可以生成网页、保存项目和查看历史版本。</p>

          {status === 'in' && (
            <div className="mb-5 rounded-[10px] bg-[#F0FDF4] border border-[#BBF7D0] p-3 text-sm text-[#15803D] flex items-center justify-between">
              <span>你已登录</span>
              <button onClick={() => navigate('/')} className="underline">进入工坊</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-[#F3F4F6] mb-5" role="tablist">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                className={`h-9 rounded-[8px] text-sm font-medium ${mode === m ? 'bg-white shadow-sm text-[#111827]' : 'text-[#6B7280]'}`}>
                {m === 'login' ? '邮箱登录' : '邮箱注册'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="email">邮箱</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input(errors.email)} placeholder="you@example.com" />
            {errors.email && <p className="text-xs text-[#DC2626] -mt-2">{errors.email}</p>}

            <label className="text-sm font-medium" htmlFor="password">密码</label>
            <div className="relative">
              <input id="password" type={show ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={`${input(errors.password)} pr-10`} placeholder={mode === 'register' ? '8—64 位，包含字母和数字' : '请输入密码'} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? '隐藏密码' : '显示密码'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#6B7280] hover:text-[#111827]">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            {errors.password && <p className="text-xs text-[#DC2626] -mt-2">{errors.password}</p>}
            {mode === 'register' && password && (
              <div className="-mt-1 flex items-center gap-2" aria-live="polite">
                <div className="flex-1 grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 rounded-full" style={{ background: i < strength ? STRENGTH[strength - 1].color : '#E5E7EB' }} />)}</div>
                <span className="text-xs" style={{ color: strength ? STRENGTH[strength - 1].color : '#9CA3AF' }}>密码强度：{strength ? STRENGTH[strength - 1].label : '太弱'}</span>
              </div>
            )}

            {mode === 'register' && (
              <>
                <label className="text-sm font-medium" htmlFor="confirm">确认密码</label>
                <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input(errors.confirm)} placeholder="再次输入密码" />
                {errors.confirm && <p className="text-xs text-[#DC2626] -mt-2">{errors.confirm}</p>}
              </>
            )}

            {serverError && <div role="alert" className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] p-3 text-sm text-[#DC2626]">{serverError}</div>}

            <button type="submit" disabled={loading} className="mt-1 h-11 rounded-[10px] bg-[#2F6BFF] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#2459DB] disabled:opacity-60">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5 text-xs text-[#9CA3AF]"><span className="flex-1 h-px bg-[#E5E7EB]" />或<span className="flex-1 h-px bg-[#E5E7EB]" /></div>

          <button onClick={() => client.auth.toLogin()} className="w-full h-11 rounded-[10px] border border-[#E5E7EB] !bg-white hover:!bg-[#F9FAFB] text-sm font-medium text-[#111827] flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2F6BFF]" />使用平台统一账号登录
          </button>
          <p className="text-xs text-[#9CA3AF] mt-4 leading-relaxed">说明：邮箱账号和平台统一账号是两套独立账号，项目分别保存、互不相通。连续输错 5 次密码会锁定 15 分钟。</p>
        </div>
      </div>
    </div>
  );
}
