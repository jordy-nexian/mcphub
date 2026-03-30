export function StatsCard(props: {
  value: string | number;
  label: string;
  trend?: { direction: "up" | "down"; text: string };
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{props.value}</div>
      <div className="stat-card-label">{props.label}</div>
      {props.trend ? (
        <div className={`stat-card-trend ${props.trend.direction}`}>
          {props.trend.direction === "up" ? "↑" : "↓"} {props.trend.text}
        </div>
      ) : null}
    </div>
  );
}
