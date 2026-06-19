"use client";

type ScoreGaugeProps = {
  score: number;
  maxScore?: number;
  size?: number;
  label?: string;
};

function scoreToColor(score: number, max: number): { stroke: string; glow: string; textColor: string } {
  const pct = score / max;
  if (pct >= 0.72) return { stroke: "#34d399", glow: "rgba(52,211,153,0.5)", textColor: "text-emerald-300" };
  if (pct >= 0.52) return { stroke: "#facc15", glow: "rgba(250,204,21,0.4)", textColor: "text-yellow-300" };
  return { stroke: "#f87171", glow: "rgba(248,113,113,0.4)", textColor: "text-red-400" };
}

function scoreToLabel(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.72) return "上昇候補";
  if (pct >= 0.52) return "中立";
  return "リスク監視";
}

export function ScoreGauge({ score, maxScore = 100, size = 120, label }: ScoreGaugeProps) {
  const { stroke, glow, textColor } = scoreToColor(score, maxScore);
  const displayLabel = label ?? scoreToLabel(score, maxScore);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const strokeWidth = size * 0.085;
  const trackWidth = size * 0.07;

  // Arc: 225deg start, 270deg sweep (leaving a gap at bottom)
  const startAngle = 225;
  const sweepAngle = 270;
  const pct = Math.min(1, Math.max(0, score / maxScore));
  const fillSweep = sweepAngle * pct;

  function polarToXY(deg: number, radius: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function arcPath(startDeg: number, sweep: number, radius: number) {
    if (sweep <= 0) return "";
    const capped = Math.min(sweep, 359.99);
    const start = polarToXY(startDeg, radius);
    const end = polarToXY(startDeg + capped, radius);
    const largeArc = capped > 180 ? 1 : 0;
    return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
  }

  const trackPath = arcPath(startAngle, sweepAngle, r);
  const fillPath = arcPath(startAngle, fillSweep, r);
  const filterId = `gauge-glow-${score}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`スコア ${score}/${maxScore}`}
      >
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={size * 0.055} result="blur" />
            <feFlood floodColor={glow} result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth={trackWidth}
          strokeLinecap="round"
        />

        {/* Fill arc */}
        {fillPath ? (
          <path
            d={fillPath}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            filter={`url(#${filterId})`}
          />
        ) : null}

        {/* Center score */}
        <text
          x={cx}
          y={cy - size * 0.04}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#f8fafc"
          fontSize={size * 0.24}
          fontWeight="900"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {score}
        </text>
        <text
          x={cx}
          y={cy + size * 0.175}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#64748b"
          fontSize={size * 0.1}
          fontWeight="700"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          / {maxScore}
        </text>
      </svg>
      <p className={`text-xs font-black ${textColor}`}>{displayLabel}</p>
    </div>
  );
}
