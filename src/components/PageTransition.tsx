"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * ページ遷移アニメーション
 * key を変えずに DOM ref でアニメーションを再起動するため、
 * 子コンポーネントのアンマウント→再マウントを起こさない。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 初回マウント時は CSS の initial animation で再生するので skip
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    // アニメーションをリセットしてから再起動
    el.style.animation = "none";
    void el.offsetHeight; // reflow trigger
    el.style.animation = "page-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both";
  }, [pathname]);

  return (
    <div
      ref={ref}
      style={{ animation: "page-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both" }}
    >
      {children}
    </div>
  );
}
