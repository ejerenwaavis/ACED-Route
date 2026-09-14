import React from 'react';
import {
  Compass,
  Crosshair,
  Volume2,
  VolumeX,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
  Sun,
  Moon
} from 'lucide-react';

export default function MapFloatingControls({
  isNavigating = false,
  isFullscreen = false,
  userIsPanning = false,
  isMuted = false,
  mapTheme = 'street',
  onToggleFullscreen,
  onToggleTheme,
  onRecenter,
  onFitBounds,
  onToggleMute,
  onZoomIn,
  onZoomOut,
  t = (k) => k,
}) {
  return (
    <div className="maplibre-controls-overlay">
      {/* Fullscreen Toggle */}
      {onToggleFullscreen && (
        <button
          className="map-control-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? t('exitFullView') || 'Exit Fullscreen' : t('fullView') || 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      )}

      {/* Theme / Vector Mode Toggle */}
      {onToggleTheme && (
        <button
          className="map-control-btn"
          onClick={onToggleTheme}
          title={mapTheme === 'street' ? t('nightMode') || 'Night Mode' : t('vectorStreet') || 'Day Street'}
        >
          {mapTheme === 'street' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      )}

      {/* Voice Guidance Mute Toggle (Shown during navigation or guidance) */}
      {onToggleMute && (
        <button
          className={`map-control-btn ${isMuted ? 'map-control-muted' : ''}`}
          onClick={onToggleMute}
          title={isMuted ? 'Unmute voice guidance' : 'Mute voice guidance'}
        >
          {isMuted ? <VolumeX size={17} color="#E5484D" /> : <Volume2 size={17} color="#20A564" />}
        </button>
      )}

      {/* Fit All Stops in View (Compass) */}
      {onFitBounds && (
        <button
          className="map-control-btn"
          onClick={onFitBounds}
          title="Fit All Stops in View"
        >
          <Compass size={16} />
        </button>
      )}

      {/* Recenter to Active Stop / Vehicle (Highlighted when free-panning) */}
      {onRecenter && (
        <button
          className={`map-control-btn ${userIsPanning ? 'map-control-recenter-active' : ''}`}
          onClick={onRecenter}
          title={userIsPanning ? 'Resume Following Vehicle' : 'Recenter to Active Stop'}
        >
          <Crosshair size={16} />
        </button>
      )}

      {/* Zoom Controls */}
      {onZoomIn && (
        <button
          className="map-control-btn"
          onClick={onZoomIn}
          title="Zoom In"
        >
          <Plus size={16} />
        </button>
      )}
      {onZoomOut && (
        <button
          className="map-control-btn"
          onClick={onZoomOut}
          title="Zoom Out"
        >
          <Minus size={16} />
        </button>
      )}
    </div>
  );
}
