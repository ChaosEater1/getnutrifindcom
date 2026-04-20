interface Props {
  loading: boolean;
  tip: string;
  error: string | null;
}

export function AiTip({ loading, tip, error }: Props) {
  if (!loading && !tip && !error) return null;

  return (
    <div className="ai-box">
      <div className="ai-box-lbl">🥦 Nutritionist Tip</div>
      {loading ? (
        <div className="ai-box-text" style={{ opacity: 0.6 }}>
          Analysing this food category…
        </div>
      ) : error ? (
        <div className="ai-box-text" style={{ opacity: 0.7 }}>
          {error}
        </div>
      ) : (
        <div className="ai-box-text">{tip}</div>
      )}
    </div>
  );
}
