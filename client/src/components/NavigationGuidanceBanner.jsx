import React from 'react';
import { formatDistance } from '../utils/geoUtils';
import { translateManeuver, t, getLanguage } from '../utils/i18n';

/**
 * Returns an SVG icon path corresponding to Valhalla or generic turn types.
 */
function getManeuverIcon(instruction = '', type = 0) {
  const lower = instruction.toLowerCase();

  if (lower.includes('u-turn') || lower.includes('cambio de sentido')) {
    return (
      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a5 5 0 015 5v6m0 0l-3-3m3 3l3-3M3 10l3-3M3 10l3 3" />
      </svg>
    );
  }
  if (lower.includes('left') || lower.includes('izquierda')) {
    return (
      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
    );
  }
  if (lower.includes('right') || lower.includes('derecha')) {
    return (
      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
      </svg>
    );
  }
  if (lower.includes('arrive') || lower.includes('llegad') || lower.includes('destino')) {
    return (
      <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }

  // Default: straight / continue ahead
  return (
    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>
  );
}

export default function NavigationGuidanceBanner({
  currentInstruction,
  nextInstruction,
  distanceToManeuver,
  isRecalculating,
  isMuted,
  onToggleMute,
  language = getLanguage(),
}) {
  if (!currentInstruction && !isRecalculating) {
    return null;
  }

  const rawInstruction = currentInstruction?.instruction || '';
  const displayInstruction = translateManeuver(rawInstruction, language);
  const formattedDist = formatDistance(distanceToManeuver, 'imperial');

  return (
    <div className="absolute top-16 left-3 right-3 z-30 pointer-events-none transition-all duration-300">
      <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 overflow-hidden">
        {/* Recalculating alert header */}
        {isRecalculating && (
          <div className="bg-amber-500/90 text-slate-950 px-4 py-1.5 text-xs font-bold flex items-center justify-center gap-2 animate-pulse">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>{t('recalculating')}</span>
          </div>
        )}

        <div className="p-4 flex items-center gap-4">
          {/* Turn Maneuver Icon */}
          <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-emerald-600/90 flex items-center justify-center shadow-lg border border-emerald-400/40">
            {getManeuverIcon(rawInstruction, currentInstruction?.type)}
          </div>

          {/* Turn Text & Distance */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-white">
                {formattedDist || '--'}
              </span>
            </div>
            <p className="text-base font-semibold text-slate-100 truncate leading-snug">
              {displayInstruction || 'Follow route'}
            </p>
          </div>

          {/* Mute Voice Button */}
          {typeof onToggleMute === 'function' && (
            <button
              onClick={onToggleMute}
              className={`p-2.5 rounded-xl border transition-all ${
                isMuted
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 hover:bg-rose-500/30'
                  : 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-700'
              }`}
              title={isMuted ? 'Unmute voice guidance' : 'Mute voice guidance'}
              aria-label="Toggle voice guidance"
            >
              {isMuted ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Next Subsequent Turn Preview Strip */}
        {nextInstruction && (
          <div className="bg-slate-950/60 px-4 py-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium text-slate-500 uppercase tracking-wider text-[10px]">
              {language === 'es' ? 'LUEGO' : 'THEN'}
            </span>
            <span className="truncate ml-2 text-slate-300 font-medium">
              {translateManeuver(nextInstruction.instruction, language)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
