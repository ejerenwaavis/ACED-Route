/**
 * ACED Route — Lightweight Internationalization (i18n) Engine
 * Supports English ('en') and Spanish ('es') with persistent state.
 */

const STORAGE_KEY = 'aced_language';

const translations = {
  en: {
    upload: 'Upload',
    sequencer: 'Sequencer',
    navigation: 'Navigation',
    manifests: 'Manifests',
    offlineMaps: 'Offline Maps',
    logout: 'Log Out',

    routeSequencing: 'Route Sequencing & Order',
    reviewStopSequence: 'Review the stop sequence. Reorder any stops manually before departing.',
    graphLearningActive: 'Graph Learning Active',
    initialSequence: 'Initial Upload Sequence',
    startRoute: 'Start Route',
    savingSequence: 'Saving Sequence...',
    interactiveRouteMap: 'Interactive Route Map',
    stopOrder: 'Stop Order',
    resetToSuggestion: 'Reset to Suggestion',
    target: 'Target',

    fullView: 'Full View',
    exitFullView: 'Exit Full View',
    back: 'Back',
    vectorStreet: 'Street View',
    nightMode: 'Night Mode',
    offlineDark: 'Offline Basemap',

    stopDetails: 'Stop Details',
    package: 'PKG',
    gate: 'Gate',
    navigateHere: 'Navigate Here',
    nextInSequence: 'Next In Sequence',
    delivered: 'Delivered',
    failedAttempt: 'Attempt / Skip',
    completeDelivery: 'Complete Delivery',

    recalculating: 'Recalculating route...',
    arrivedAtStop: 'You have arrived at Stop #{number}',
    headToward: 'Head toward {dest}',
    continueTo: 'Continue to {dest}',
    turnLeft: 'Turn left onto {street}',
    turnRight: 'Turn right onto {street}',
    slightLeft: 'Slight left onto {street}',
    slightRight: 'Slight right onto {street}',
    sharpLeft: 'Sharp left onto {street}',
    sharpRight: 'Sharp right onto {street}',
    uTurn: 'Make a U-turn',
    keepStraight: 'Continue straight on {street}',
    inDistance: 'In {distance}, {instruction}',

    offlineMapRequired: 'Offline Map Required',
    offlineMapDesc: 'Offline map for {region} required ({size} MB — routing + visual map). Download now?',
    wifiConnected: 'Connected via Wi-Fi (Recommended)',
    cellularDetected: 'Cellular connection detected. Wi-Fi is recommended to conserve mobile data.',
    downloadNow: 'Download Now',
    later: 'Later',
    downloadingTiles: 'Downloading Valhalla routing tile bundle...',
    downloadingBasemap: 'Downloading PMTiles visual basemap archive...',
    extractionComplete: 'Extraction complete. Offline map ready!',

    feet: 'ft',
    miles: 'mi',
    meters: 'm',
    kilometers: 'km',
    min: 'min',
    hours: 'hr'
  },

  es: {
    upload: 'Subir',
    sequencer: 'Secuenciador',
    navigation: 'Navegación',
    manifests: 'Manifiestos',
    offlineMaps: 'Mapas Sin Conexión',
    logout: 'Cerrar Sesión',

    routeSequencing: 'Secuencia y Orden de Ruta',
    reviewStopSequence: 'Revise la secuencia de paradas. Reordene manualmente antes de salir.',
    graphLearningActive: 'Aprendizaje de Gráfico Activo',
    initialSequence: 'Secuencia Inicial de Carga',
    startRoute: 'Iniciar Ruta',
    savingSequence: 'Guardando Secuencia...',
    interactiveRouteMap: 'Mapa Interactivo de Ruta',
    stopOrder: 'Orden de Paradas',
    resetToSuggestion: 'Restablecer a Sugerencia',
    target: 'Destino',

    fullView: 'Pantalla Completa',
    exitFullView: 'Salir de Pantalla Completa',
    back: 'Atrás',
    vectorStreet: 'Vista de Calle',
    nightMode: 'Modo Nocturno',
    offlineDark: 'Mapa Sin Conexión',

    stopDetails: 'Detalles de Parada',
    package: 'PAQ',
    gate: 'Código',
    navigateHere: 'Navegar Aquí',
    nextInSequence: 'Siguiente en Secuencia',
    delivered: 'Entregado',
    failedAttempt: 'Intento / Omitir',
    completeDelivery: 'Completar Entrega',

    recalculating: 'Recalculando ruta...',
    arrivedAtStop: 'Ha llegado a la parada #{number}',
    headToward: 'Diríjase hacia {dest}',
    continueTo: 'Continúe hacia {dest}',
    turnLeft: 'Gire a la izquierda en {street}',
    turnRight: 'Gire a la derecha en {street}',
    slightLeft: 'Gire levemente a la izquierda en {street}',
    slightRight: 'Gire levemente a la derecha en {street}',
    sharpLeft: 'Gire bruscamente a la izquierda en {street}',
    sharpRight: 'Gire bruscamente a la derecha en {street}',
    uTurn: 'Dé una vuelta en U',
    keepStraight: 'Continúe recto por {street}',
    inDistance: 'En {distance}, {instruction}',

    offlineMapRequired: 'Mapa Sin Conexión Requerido',
    offlineMapDesc: 'Se requiere mapa sin conexión para {region} ({size} MB — ruteo + mapa visual). ¿Descargar ahora?',
    wifiConnected: 'Conectado por Wi-Fi (Recomendado)',
    cellularDetected: 'Conexión celular detectada. Se recomienda Wi-Fi para conservar datos móviles.',
    downloadNow: 'Descargar Ahora',
    later: 'Más Tarde',
    downloadingTiles: 'Descargando paquete de ruteo Valhalla...',
    downloadingBasemap: 'Descargando archivo de mapa PMTiles...',
    extractionComplete: '¡Extracción completada! Mapa listo.',

    feet: 'pies',
    miles: 'mi',
    meters: 'm',
    kilometers: 'km',
    min: 'min',
    hours: 'h'
  }
};

let currentLang = 'en';

if (typeof window !== 'undefined') {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (saved === 'en' || saved === 'es')) {
    currentLang = saved;
  }
}

const listeners = new Set();

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'es') return;
  currentLang = lang;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, lang);
  }
  listeners.forEach((cb) => cb(lang));
}

export function onLanguageChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key, params = {}) {
  const dict = translations[currentLang] || translations.en;
  let str = dict[key] || translations.en[key] || key;

  Object.entries(params).forEach(([k, v]) => {
    str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  });

  return str;
}

export function translateManeuver(instruction, lang = currentLang) {
  if (!instruction) return '';
  if (lang === 'en') return instruction;

  return instruction
    .replace(/^Turn left onto\s+/i, 'Gire a la izquierda en ')
    .replace(/^Turn right onto\s+/i, 'Gire a la derecha en ')
    .replace(/^Turn left\b/i, 'Gire a la izquierda')
    .replace(/^Turn right\b/i, 'Gire a la derecha')
    .replace(/^Bear left onto\s+/i, 'Manténgase a la izquierda en ')
    .replace(/^Bear right onto\s+/i, 'Manténgase a la derecha en ')
    .replace(/^Continue onto\s+/i, 'Continúe por ')
    .replace(/^Continue straight\b/i, 'Continúe recto')
    .replace(/^Make a U-turn\b/i, 'Haga un cambio de sentido')
    .replace(/^Keep left\b/i, 'Manténgase a la izquierda')
    .replace(/^Keep right\b/i, 'Manténgase a la derecha')
    .replace(/^Take the ramp\b/i, 'Tome la rampa')
    .replace(/^Head toward\s+/i, 'Diríjase hacia ')
    .replace(/^Arrive at\s+/i, 'Llegada a ')
    .replace(/\bdestination\b/i, 'destino');
}
