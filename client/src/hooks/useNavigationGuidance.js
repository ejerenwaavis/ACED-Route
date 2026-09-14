import { useState, useEffect, useRef, useMemo } from 'react';
import { distanceToPolyline, haversineDistance } from '../utils/geoUtils';
import { translateManeuver, t, getLanguage } from '../utils/i18n';
import routingService from '../services/routing';

const OFF_ROUTE_THRESHOLD_METERS = 30; // 30m off-route triggers reroute
const OFF_ROUTE_CONFIRMATION_TICKS = 2; // Require 2 consecutive ticks to avoid GPS drift
const ARRIVAL_THRESHOLD_METERS = 20;

/**
 * useNavigationGuidance manages real-time maneuver tracking, spoken turn alerts,
 * and 30m cross-track off-route detection with automatic rerouting.
 */
export function useNavigationGuidance({
  route,
  currentLocation,
  onRerouteNeeded,
  isMuted = false,
  language = getLanguage(),
  enabled = false,
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToManeuver, setDistanceToManeuver] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Spoken alert deduplication state: { [stepIndex]: { initial, ft500, ft150 } }
  const spokenFlags = useRef({});
  const offRouteTicks = useRef(0);
  const rerouteCooldown = useRef(0);
  const lastSpokenText = useRef('');

  // Pre-calculate cumulative distance marks for each maneuver step
  const stepMarks = useMemo(() => {
    if (!route || !route.instructions || route.instructions.length === 0) {
      return [];
    }
    let cum = 0;
    return route.instructions.map((step) => {
      cum += step.distanceMeters || 0;
      return cum;
    });
  }, [route]);

  // Pre-calculate cumulative distance along the polyline coordinates
  const polylineDistances = useMemo(() => {
    if (!route || !route.coordinates || route.coordinates.length < 2) {
      return [];
    }
    const dists = [0];
    let total = 0;
    for (let i = 0; i < route.coordinates.length - 1; i++) {
      const p1 = route.coordinates[i];
      const p2 = route.coordinates[i + 1];
      total += haversineDistance(p1[1], p1[0], p2[1], p2[0]);
      dists.push(total);
    }
    return dists;
  }, [route]);

  // Compute a stable fingerprint for the route so we only reset spoken state
  // when the route *actually changes* (different path or step count), not when
  // a new object reference arrives with identical content.
  const routeFingerprint = useMemo(() => {
    if (!route || !route.coordinates || route.coordinates.length === 0) return null;
    const first = route.coordinates[0];
    const last = route.coordinates[route.coordinates.length - 1];
    const steps = route.instructions?.length ?? 0;
    return `${first?.[0]?.toFixed(5)},${first?.[1]?.toFixed(5)}_${last?.[0]?.toFixed(5)},${last?.[1]?.toFixed(5)}_${steps}`;
  }, [route]);

  // Reset step progression only when the route fingerprint changes (new actual path)
  useEffect(() => {
    setCurrentStepIndex(0);
    setDistanceToManeuver(0);
    setIsRecalculating(false);
    spokenFlags.current = {};
    offRouteTicks.current = 0;
    lastSpokenText.current = '';
  }, [routeFingerprint]);

  // Silence TTS immediately when navigation is disabled / exited
  useEffect(() => {
    if (!enabled) {
      spokenFlags.current = {};
      lastSpokenText.current = '';
      routingService.stopSpeech();
    }
  }, [enabled]);

  // Voice announcement helper with deduplication
  const announce = (text) => {
    if (!enabled || isMuted || !text || text === lastSpokenText.current) return;
    lastSpokenText.current = text;
    routingService.speak(text, { lang: language });
  };

  // Main guidance evaluation loop on each GPS fix
  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!route || !route.coordinates || route.coordinates.length === 0 || !currentLocation) {
      return;
    }

    const { latitude, longitude } = currentLocation;

    // 1. Calculate cross-track distance to the route line
    const { distance: crossTrack, nearestSegmentIndex } = distanceToPolyline(
      latitude,
      longitude,
      route.coordinates
    );

    // 2. Off-Route Evaluation (30-meter threshold)
    const now = Date.now();
    if (crossTrack > OFF_ROUTE_THRESHOLD_METERS) {
      offRouteTicks.current += 1;
      if (
        offRouteTicks.current >= OFF_ROUTE_CONFIRMATION_TICKS &&
        now - rerouteCooldown.current > 6000
      ) {
        rerouteCooldown.current = now;
        setIsRecalculating(true);
        announce(t('recalculating'));
        if (typeof onRerouteNeeded === 'function') {
          onRerouteNeeded([latitude, longitude]);
        }
      }
    } else {
      offRouteTicks.current = 0;
      if (isRecalculating) {
        setIsRecalculating(false);
      }
    }

    // 3. Compute driver's progress along the polyline in meters
    let driverProgress = 0;
    if (polylineDistances.length > nearestSegmentIndex) {
      driverProgress = polylineDistances[nearestSegmentIndex];
      // Add partial distance from segment start to current point
      const segStart = route.coordinates[nearestSegmentIndex];
      driverProgress += haversineDistance(
        segStart[1],
        segStart[0],
        latitude,
        longitude
      );
    }

    // 4. Determine current step based on driver progress
    let activeStepIdx = 0;
    for (let i = 0; i < stepMarks.length; i++) {
      if (driverProgress < stepMarks[i] || i === stepMarks.length - 1) {
        activeStepIdx = i;
        break;
      }
    }
    setCurrentStepIndex(activeStepIdx);

    const stepEndMark = stepMarks[activeStepIdx] || 0;
    const distToManeuver = Math.max(0, stepEndMark - driverProgress);
    setDistanceToManeuver(distToManeuver);

    const instructions = route.instructions || [];
    const currentStep = instructions[activeStepIdx];
    const nextStep = instructions[activeStepIdx + 1];

    if (!spokenFlags.current[activeStepIdx]) {
      spokenFlags.current[activeStepIdx] = {
        initial: false,
        ft500: false,
        ft150: false,
      };
    }
    const flags = spokenFlags.current[activeStepIdx];

    // Announce initial instruction when entering step
    if (!flags.initial && currentStep) {
      flags.initial = true;
      const translated = translateManeuver(currentStep.instruction, language);
      announce(translated);
    }

    // Approaching next maneuver announcements
    if (nextStep) {
      const nextTranslated = translateManeuver(nextStep.instruction, language);

      // 500 ft mark (~152m)
      if (distToManeuver <= 165 && distToManeuver > 60 && !flags.ft500) {
        flags.ft500 = true;
        const msg =
          language === 'es'
            ? `En 500 pies, ${nextTranslated}`
            : `In 500 feet, ${nextTranslated}`;
        announce(msg);
      }

      // 150 ft mark (~46m)
      if (distToManeuver <= 50 && distToManeuver > 15 && !flags.ft150) {
        flags.ft150 = true;
        const msg =
          language === 'es'
            ? `En 150 pies, ${nextTranslated}`
            : `In 150 feet, ${nextTranslated}`;
        announce(msg);
      }
    } else {
      // Final leg: arrival announcement
      if (distToManeuver <= ARRIVAL_THRESHOLD_METERS && !flags.ft150) {
        flags.ft150 = true;
        const arrivalMsg =
          language === 'es'
            ? 'Ha llegado a su destino'
            : 'You have arrived at your destination';
        announce(arrivalMsg);
      }
    }
  }, [currentLocation, route, stepMarks, polylineDistances, language, isMuted, enabled]);

  const currentInstruction = route?.instructions?.[currentStepIndex];
  const nextInstruction = route?.instructions?.[currentStepIndex + 1];

  return {
    currentStepIndex,
    distanceToManeuver,
    isRecalculating,
    currentInstruction,
    nextInstruction,
    announce,
  };
}
