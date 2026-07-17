export default function Sparkline({ prices = [], height = 40, width = 120 }) {
  if (prices.length < 2) return <div style={{ height, width }} />;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - ((p - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const isUp = prices[prices.length - 1] >= prices[0];
  const lineColor = isUp ? '#00ff88' : '#ff3b3b';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
