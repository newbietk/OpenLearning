import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { ToastContainer } from "@/components/toast";

export const metadata: Metadata = {
  title: "Knowledge Platform",
  description: "AI-powered knowledge management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: "clamp(200px, 16vw, 280px)", padding: "clamp(12px, 2vw, 40px) clamp(14px, 2.5vw, 48px)" }}>
          {children}
        </main>
        <ToastContainer />
      </body>
    </html>
  );
}
