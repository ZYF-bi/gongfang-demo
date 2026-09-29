import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Wand2 } from 'lucide-react';
import { client, buildPreview, errorText } from '@/lib/workshop';

type Shared = { name: string; html: string; revision: number };

export default function Share() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const channel = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    client.apiCall.invoke({ url: `/api/v1/share/page/${encodeURIComponent(token)}`, method: 'GET', data: {} })
      .then((r) => setData(r.data))
      .catch((e) => setError(errorText(e)));
  }, [token]);

  return (
    <div className="h-screen flex flex-col bg-[#F7F8FA] text-[#111827]" style={{ fontFamily: '"Noto Sans SC", system-ui, sans-serif' }}>
      <header className="h-12 shrink-0 bg-white border-b border-[#E5E7EB] px-4 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#2F6BFF] text-white flex items-center justify-center shrink-0"><Wand2 className="w-4 h-4" /></span>
          <span className="text-sm font-semibold truncate">{data ? `${data.name} · 第 ${data.revision} 版` : '分享的作品'}</span>
        </div>
        <Link to="/" className="h-8 px-3 rounded-[8px] bg-[#2F6BFF] text-white text-xs flex items-center shrink-0">我也来做一个</Link>
      </header>
      <main className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-semibold">无法打开这个作品</p>
            <p className="text-sm text-[#6B7280]">{error}</p>
          </div>
        ) : !data ? (
          <div className="h-full flex items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="w-4 h-4 animate-spin" />加载中…</div>
        ) : (
          <iframe title={data.name} sandbox="allow-scripts" srcDoc={buildPreview(data.html, channel)} className="block w-full h-full border-0 bg-white" />
        )}
      </main>
    </div>
  );
}
