"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { buildPreview, previewMessage } from "@/lib/preview";

export default function Preview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const channel = useMemo(() => crypto.randomUUID(), [html, version]);
  const document = useMemo(() => buildPreview(html, channel), [html, channel]);
  useEffect(() => {
    setError("");
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = previewMessage(event.data, channel);
      if (message) setError(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [channel]);
  return (
    <div className="preview-shell">
      <div className="preview-meta">
        <span>
          <i className="live-dot" />
          独立预览环境
        </span>
        <button
          className="text-button"
          onClick={() => setVersion((v) => v + 1)}
        >
          <RotateCcw size={13} />
          重置预览
        </button>
      </div>
      {error && (
        <div className="notice warning" role="alert">
          <AlertTriangle size={16} />
          <span>应用运行提示：{error}。可在左侧补充要求修复。</span>
        </div>
      )}
      <iframe
        key={channel}
        ref={frame}
        title="生成应用预览"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={document}
      />
      <div className="preview-footnote">
        预览中的应用数据仅保留在本次运行中；重置后会清空。
      </div>
    </div>
  );
}
