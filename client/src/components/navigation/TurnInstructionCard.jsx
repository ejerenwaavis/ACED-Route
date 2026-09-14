import React from 'react';
import { formatDistance } from '../../utils/geoUtils';
import { translateManeuver, t, getLanguage } from '../../utils/i18n';

/**
 * Renders large, crisp turn maneuver icon matching the Dark Chrome design system.
 */
function getManeuverIcon(instruction = '', type = 0) {
  const lower = instruction.toLowerCase();

  if (lower.includes('u-turn') || lower.includes('cambio de sentido')) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10h10a5 5 0 0 1 5 5v6" />
        <path d="m15 18 3 3 3-3" />
        <path d="M3 10l3-3M3 10l3 3" />
      </svg>
    );
  }
  if (lower.includes('left') || lower.includes('izquierda')) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
    );
  }
  if (lower.includes('right') || lower.includes('derecha')) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    );
  }
  if (lower.includes('arrive') || lower.includes('llegad') || lower.includes('destino')) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-orange-action, #F28C28)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }

  // Default: straight / continue ahead
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export default function TurnInstructionCard({
  currentInstruction,
  nextInstruction,
  distanceToManeuver,
  isRecalculating,
  language = getLanguage(),
}) {
  if (!currentInstruction && !isRecalculating) {
    return null;
  }

  const rawInstruction = currentInstruction?.instruction || '';
  const displayInstruction = translateManeuver(rawInstruction, language);
  const formattedDist = formatDistance(distanceToManeuver, 'imperial');

  return (
    <div className="turn-card-pinned-container">
      <div className="turn-instruction-card">
        {/* Recalculating pulse banner */}
        {isRecalculating && (
          <div className="turn-recalculating-bar">
            <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>{t('recalculating') || 'Recalculating route...'}</span>
          </div>
        )}

        <div className="turn-instruction-body">
          {/* Turn Maneuver Icon */}
          <div className="turn-maneuver-icon-box">
            {getManeuverIcon(rawInstruction, currentInstruction?.type)}
          </div>

          {/* Maneuver Distance & Street Name */}
          <div className="turn-instruction-text-block">
            <div className="turn-distance-label">
              {formattedDist || '--'}
            </div>
            <div className="turn-street-name" title={displayInstruction}>
              {displayInstruction || 'Follow route'}
            </div>
          </div>
        </div>

        {/* Subsequent Next Maneuver Preview Strip */}
        {nextInstruction && (
          <div className="turn-subsequent-strip">
            <span className="turn-subsequent-label">
              {language === 'es' ? 'LUEGO' : 'THEN'}
            </span>
            <span className="turn-subsequent-text">
              {translateManeuver(nextInstruction.instruction, language)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
