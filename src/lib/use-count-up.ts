"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 数値をアニメーションしながら 0 から target まで増加させるフック
 * @param target    目標値
 * @param duration  アニメーション時間(ms)
 * @param enabled   false のときはすぐに target を返す
 */
export function useCountUp(
  target: number,
  duration = 900,
  enabled = true
): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const prevTarget = useRef<number>(enabled ? 0 : target);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      prevTarget.current = target;
      return;
    }

    const from = prevTarget.current;
    const to = target;
    prevTarget.current = target;

    if (from === to) return;

    startTime.current = null;

    function step(ts: number) {
      if (startTime.current === null) startTime.current = ts;
      const elapsed = ts - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        rafId.current = requestAnimationFrame(step);
      }
    }

    rafId.current = requestAnimationFrame(step);

    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [target, duration, enabled]);

  return value;
}
