import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { MAX_HTML_BYTES } from "./validation";
import { AppError } from "./errors";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
const forbidden = new Set([
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "base",
  "meta",
  "link",
]);
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function validateHtml(raw: string): string {
  const html = raw
    .trim()
    .replace(/^```(?:html)?\s*\n/i, "")
    .replace(/\n```\s*$/, "")
    .trim();
  if (!html || new TextEncoder().encode(html).length > MAX_HTML_BYTES)
    throw new AppError(
      "INVALID_OUTPUT",
      "模型返回的代码为空或超过 200 KB，请缩小需求后重试",
      502,
    );
  if (
    !/<html[\s>]/i.test(html) ||
    !/<body[\s>]/i.test(html) ||
    !/<\/html\s*>/i.test(html)
  )
    throw new AppError("INVALID_OUTPUT", "模型未返回完整网页，请重试", 502);
  const tree = parse(html);
  let external = false;
  function inspect(node: Node) {
    if ("tagName" in node) {
      if (node.tagName === "script" && node.attrs.some((a) => a.name === "src"))
        external = true;
      if (node.tagName === "link" && node.attrs.some((a) => a.name === "href"))
        external = true;
    }
    if ("childNodes" in node) node.childNodes.forEach(inspect);
  }
  inspect(tree);
  if (external)
    throw new AppError(
      "INVALID_OUTPUT",
      "生成结果依赖外部资源，请补充“不使用外部依赖”后重试",
      502,
    );
  return html;
}

export function buildPreview(html: string, channel: string): string {
  const tree = parse(html);
  function clean(parent: Node) {
    if (!("childNodes" in parent)) return;
    parent.childNodes = parent.childNodes.filter(
      (node) => !("tagName" in node) || !forbidden.has(node.tagName),
    );
    for (const child of parent.childNodes) {
      if ("tagName" in child) {
        const el = child as Element;
        el.attrs = el.attrs.filter(
          (a) =>
            ![
              "src",
              "srcset",
              "href",
              "action",
              "formaction",
              "target",
              "ping",
              "download",
              "srcdoc",
              "xlink:href",
            ].includes(a.name) ||
            (el.tagName === "img" &&
              a.name === "src" &&
              a.value.startsWith("data:image/")),
        );
        if (el.tagName === "template" && "content" in el)
          clean(el.content as Node);
      }
      clean(child);
    }
  }
  clean(tree);
  const safeChannel = JSON.stringify(channel).replace(/</g, "\\u003c");
  const guard = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>(()=>{const c=${safeChannel};const send=(text)=>parent.postMessage({type:'preview-error',channel:c,message:String(text).slice(0,300)},'*');window.addEventListener('error',e=>send(e.message));window.addEventListener('unhandledrejection',()=>send('应用发生未处理错误'));document.addEventListener('submit',e=>e.preventDefault());document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('a'))e.preventDefault();},true);})();</script>`;
  return serialize(tree).replace("<head>", `<head>${guard}`);
}

export function previewMessage(data: unknown, channel: string): string | null {
  if (!data || typeof data !== "object") return null;
  const v = data as Record<string, unknown>;
  return v.type === "preview-error" &&
    v.channel === channel &&
    typeof v.message === "string"
    ? v.message.slice(0, 300)
    : null;
}
