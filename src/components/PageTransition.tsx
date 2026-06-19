"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * ページ遷移アニメーション
 * パスが変化するたびに fade-slide-up アニメーションを実行する
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [animKey, setAnimKey] = useState(0);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      setAnimKey((k) => k + 1);
    }
  }, [pathname]);

  return (
    <div
      key={animKey}
      style={{
        animation: "page-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      {children}
    </div>
  );
}
