import React from 'react';
import { X, ChevronUp, Navigation, Clock } from 'lucide-react';

export default function CurrentStopChip({
  stop,
  stopIndex = 0,
  distanceStr,
  etaStr,
  onDismiss,
  onExpand,
}) {
  if (!stop) return null;

  const addr = stop.address || {};
  const primaryTitle = stop.recipient || addr.recipient || addr.street || addr.raw || `Stop #${stopIndex + 1}`;

  return (
    <div className="current-stop-chip-container">
      <div className="current-stop-chip" onClick={onExpand}>
        {/* Stop Number Badge */}
        <div className="current-stop-chip-badge">
          {stopIndex + 1}
        </div>

        {/* Recipient / Address Info */}
        <div className="current-stop-chip-info">
          <div className="current-stop-chip-title" title={primaryTitle}>
            {primaryTitle}
          </div>
          <div className="current-stop-chip-sub">
            {distanceStr && (
              <span className="current-stop-chip-meta">
                <Navigation size={11} color="var(--color-blue-nav, #2676D9)" />
                {distanceStr}
              </span>
            )}
            {etaStr && (
              <span className="current-stop-chip-meta">
                <Clock size={11} color="var(--color-gray, #8A8F96)" />
                {etaStr}
              </span>
            )}
            {addr.gateCode && (
              <span className="current-stop-chip-gate">
                Gate: #{addr.gateCode}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="current-stop-chip-actions" onClick={(e) => e.stopPropagation()}>
          {onExpand && (
            <button
              className="current-stop-chip-btn"
              onClick={onExpand}
              title="Expand Details"
            >
              <ChevronUp size={16} />
            </button>
          )}
          {onDismiss && (
            <button
              className="current-stop-chip-btn"
              onClick={onDismiss}
              title="Dismiss Chip"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
