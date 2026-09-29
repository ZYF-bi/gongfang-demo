import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "小验工坊 · 把想法变成应用",
  description: "描述你的想法，生成可以亲手体验的小应用。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
