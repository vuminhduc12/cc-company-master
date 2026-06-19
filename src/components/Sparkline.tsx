"use client";

type SparklineProps = {
  prices: number[];
  width?: number;
  height?: number;
  className?: string;
};

export function Sparkline({
  prices,
  width = 80,
  height = 32,
  className = "",
}: SparklineProps) {
  if (!prices || prices.length < 2) {
    return <div style={{ width, height }} className={`flex items-center justify-center text-[10px] text-slate-600 ${className}`}>—</div>;
  }

  const pts = prices.filter(Number.isFinite);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(max - min, 0.001);

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const toX = (i: number) => pad + (i / (pts.length - 1)) * w;
  const toY = (v: number) => pad + h - ((v - min) / span) * h;

  const points = pts.map((v, i) => `${toX(i).toFixed(2)},${toY(v).toFixed(2)}`).join(" ");
  const lastX = toX(pts.length - 1);
  const lastY = toY(pts[pts.length - 1] ?? min);
  const firstY = toY(pts[0] ?? min);

  const isUp = (pts[pts.length - 1] ?? 0) >= (pts[0] ?? 0);
  const stroke = isUp ? "#34d399" : "#f87171";
  const fillId = `spark-fill-${Math.random().toString(36).slice(2, 7)}`;

  // Closed area path for gradient fill
  const areaPath =
    `M ${pad.toFixed(2)},${firstY.toFixed(2)} ` +
    pts.map((v, i) => `L ${toX(i).toFixed(2)},${toY(v).toFixed(2)}`).join(" ") +
    ` L ${lastX.toFixed(2)},${(pad + h).toFixed(2)} L ${pad.toFixed(2)},${(pad + h).toFixed(2)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 最新値ドット */}
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} />
    </svg>
  );
}
