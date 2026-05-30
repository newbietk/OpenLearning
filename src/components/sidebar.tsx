"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navSections = [
  {
    title: "知识库",
    items: [
      { href: "/", label: "知识库列表", icon: "📚" },
      { href: "/chat", label: "AI 问答", icon: "🤖" },
    ],
  },
  {
    title: "配置",
    items: [
      { href: "/llm-config", label: "LLM 配置", icon: "⚙️" },
      { href: "/admin", label: "管理员", icon: "🔧" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">KL</div>
        <span className="sidebar-title">Knowledge Platform</span>
      </div>

      <nav className="sidebar-nav">
        {navSections.map((section) => (
          <div key={section.title} className="nav-section">
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${isActive(item.href) ? " active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-mini">
          <div className="user-avatar">匿</div>
          <div className="user-info">
            <div className="user-name">匿名用户</div>
            <div className="user-role">学习者</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
