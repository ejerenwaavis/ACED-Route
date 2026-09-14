import { useState, useEffect } from 'react';

/**
 * ACED Route — Lightweight Internationalization (i18n) Engine
 * Supports English ('en') and Spanish ('es') with reactive state updates.
 */

const STORAGE_KEY = 'aced_language';

const translations = {
  en: {
    // Navigation / Header
    upload: 'Upload',
    sequencer: 'Sequencer',
    navigation: 'Navigation',
    history: 'History',
    manifests: 'Manifests',
    offlineMaps: 'Offline Maps',
    logout: 'Log Out',
    maps: 'Maps',
    api: 'API',

    // Upload Page
    uploadTodaysManifest: "Upload Today's Manifest",
    adaptiveParserDesc: 'Adaptive parser auto-detects barcodes, delivery addresses, scanned GPS coordinates, and stop sequences from any carrier or dispatch CSV.',
    sampleRoute: 'Sample Route',
    routeDate: 'Route Date:',
    fileUploadCsv: 'File Upload (CSV)',
    pasteText: 'Paste Text',
    tapToSelectCsv: 'Tap to select a Manifest CSV file',
    carrierSupport: 'Supports OnTrac, Amazon, FedEx, UPS, LaserShip, or custom dispatch spreadsheets',
    pasteInstructions: 'Paste comma- or tab-delimited text from your route sheet below:',
    pastePlaceholder: 'e.g.\nTracking,Address\nD10012345,123 Main St Atlanta GA 30303\nD10012346,456 Oak Ave Suwanee GA 30024',
    uploadAndParse: 'Upload & Parse Route',
    parsing: 'Parsing & Geocoding Stops...',
    manifestUploadedSuccess: 'Manifest parsed and uploaded successfully!',

    // Sequencer Page
    routeSequencing: 'Route Sequencing & Order',
    reviewStopSequence: 'Review the stop sequence. Reorder any stops manually before departing.',
    graphLearningActive: 'Graph Learning Active',
    initialSequence: 'Initial Upload Sequence',
    startRoute: 'Start Route',
    startRouteStops: 'Start Route ({count} Stops)',
    savingSequence: 'Saving Sequence...',
    stopOrder: 'Stop Order',
    resetToSuggestion: 'Reset to Suggestion',
    pleaseUploadManifest: 'Please upload or open a manifest first.',

    // Navigation Page
    stopOf: 'Stop #{current} of {total}',
    routeProgress: 'Route Progress',
    stopsCountProgress: '{delivered} of {total} stops ({percent}%)',
    startNavigationToStop: 'Start Navigation to Stop #{number}',
    resumeNavigation: 'Resume In-App Navigation',
    openGoogleMaps: 'Open in Google Maps',
    delivered: 'Delivered',
    skipAttempt: 'Skip / Attempt',
    allStops: 'All Stops',
    completeRouteNow: 'Complete Route Now',
    finishing: 'Finishing...',
    addGateCode: '+ Add Gate Code',
    editGateNotes: 'Edit Gate/Notes',
    gate: 'Gate',
    note: 'Note',
    package: 'PKG',
    target: 'Target',

    // MapView
    fullView: 'Full View',
    exitFullView: 'Exit Full View',
    back: 'Back',
    exitNav: 'Exit Nav',
    vectorStreet: 'Street View',
    nightMode: 'Night Mode',
    offlineDark: 'Offline Basemap',
    interactiveRouteMap: 'Interactive Route Map ({count} Stops)',
    stopDetails: 'Stop Details',
    navigateHere: 'Navigate Here',
    nextInSequence: 'Next In Sequence',

    // Voice & Turn Prompts
    recalculating: 'Recalculating route...',
    arrivedAtStop: 'You have arrived at Stop #{number}',
    arrivedAtDestination: 'You have arrived at your destination',
    headToward: 'Head toward {dest}',
    continueTo: 'Continue to {dest}',
    then: 'THEN',

    // Offline Download Prompt
    offlineMapRequired: 'Offline Map Required',
    offlineMapDesc: 'Offline map for {region} required ({size} MB — routing + visual map). Download now?',
    wifiConnected: 'Connected via Wi-Fi (Recommended)',
    cellularDetected: 'Cellular connection detected. Wi-Fi is recommended to conserve mobile data.',
    downloadNow: 'Download Now',
    later: 'Later',
    downloadingTiles: 'Downloading Valhalla routing tile bundle...',
    downloadingBasemap: 'Downloading PMTiles visual basemap archive...',
    extractionComplete: 'Extraction complete. Offline map ready!',

    // Units
    feet: 'ft',
    miles: 'mi',
    meters: 'm',
    kilometers: 'km',
    min: 'min',
    hours: 'hr'
  },

  es: {
    // Navigation / Header
    upload: 'Subir',
    sequencer: 'Secuenciador',
    navigation: 'Navegación',
    history: 'Historial',
    manifests: 'Manifiestos',
    offlineMaps: 'Mapas Sin Conexión',
    logout: 'Cerrar Sesión',
    maps: 'Mapas',
    api: 'API',

    // Upload Page
    uploadTodaysManifest: "Subir Manifiesto de Hoy",
    adaptiveParserDesc: 'El analizador adaptable detecta códigos de barras, direcciones, coordenadas GPS y secuencias de cualquier transportista o CSV.',
    sampleRoute: 'Ruta de Ejemplo',
    routeDate: 'Fecha de Ruta:',
    fileUploadCsv: 'Subir Archivo (CSV)',
    pasteText: 'Pegar Texto',
    tapToSelectCsv: 'Toque para seleccionar un archivo CSV',
    carrierSupport: 'Compatible con OnTrac, Amazon, FedEx, UPS, LaserShip o planillas personalizadas',
    pasteInstructions: 'Pegue texto delimitado por comas o tabulaciones de su hoja de ruta a continuación:',
    pastePlaceholder: 'ej.\nGuía,Dirección\nD10012345,123 Main St Atlanta GA 30303\nD10012346,456 Oak Ave Suwanee GA 30024',
    uploadAndParse: 'Subir y Procesar Ruta',
    parsing: 'Procesando y Geocodificando Paradas...',
    manifestUploadedSuccess: '¡Manifiesto analizado y subido con éxito!',

    // Sequencer Page
    routeSequencing: 'Secuencia y Orden de Ruta',
    reviewStopSequence: 'Revise la secuencia de paradas. Reordene manualmente antes de salir.',
    graphLearningActive: 'Aprendizaje de Gráfico Activo',
    initialSequence: 'Secuencia Inicial de Carga',
    startRoute: 'Iniciar Ruta',
    startRouteStops: 'Iniciar Ruta ({count} Paradas)',
    savingSequence: 'Guardando Secuencia...',
    stopOrder: 'Orden de Paradas',
    resetToSuggestion: 'Restablecer a Sugerencia',
    pleaseUploadManifest: 'Cargue o abra un manifiesto primero.',

    // Navigation Page
    stopOf: 'Parada #{current} de {total}',
    routeProgress: 'Progreso de Ruta',
    stopsCountProgress: '{delivered} de {total} paradas ({percent}%)',
    startNavigationToStop: 'Iniciar Navegación a Parada #{number}',
    resumeNavigation: 'Reanudar Navegación',
    openGoogleMaps: 'Abrir en Google Maps',
    delivered: 'Entregado',
    skipAttempt: 'Omitir / Intentar',
    allStops: 'Todas las Paradas',
    completeRouteNow: 'Completar Ruta Ahora',
    finishing: 'Completando...',
    addGateCode: '+ Añadir Código de Portón',
    editGateNotes: 'Editar Portón/Notas',
    gate: 'Portón',
    note: 'Nota',
    package: 'PAQ',
    target: 'Destino',

    // MapView
    fullView: 'Pantalla Completa',
    exitFullView: 'Salir de Pantalla Completa',
    back: 'Atrás',
    exitNav: 'Salir de Nav',
    vectorStreet: 'Vista de Calle',
    nightMode: 'Modo Nocturno',
    offlineDark: 'Mapa Sin Conexión',
    interactiveRouteMap: 'Mapa Interactivo de Ruta ({count} Paradas)',
    stopDetails: 'Detalles de Parada',
    navigateHere: 'Navegar Aquí',
    nextInSequence: 'Siguiente en Secuencia',

    // Voice & Turn Prompts
    recalculating: 'Recalculando ruta...',
    arrivedAtStop: 'Ha llegado a la parada #{number}',
    arrivedAtDestination: 'Ha llegado a su destino',
    headToward: 'Diríjase hacia {dest}',
    continueTo: 'Continúe hacia {dest}',
    then: 'LUEGO',

    // Offline Download Prompt
    offlineMapRequired: 'Mapa Sin Conexión Requerido',
    offlineMapDesc: 'Se requiere mapa sin conexión para {region} ({size} MB — ruteo + mapa visual). ¿Descargar ahora?',
    wifiConnected: 'Conectado por Wi-Fi (Recomendado)',
    cellularDetected: 'Conexión celular detectada. Se recomienda Wi-Fi para conservar datos móviles.',
    downloadNow: 'Descargar Ahora',
    later: 'Más Tarde',
    downloadingTiles: 'Descargando paquete de ruteo Valhalla...',
    downloadingBasemap: 'Descargando archivo de mapa PMTiles...',
    extractionComplete: '¡Extracción completada! Mapa listo.',

    // Units
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
  listeners.forEach((cb) => {
    try {
      cb(lang);
    } catch (e) {
      console.warn('Language listener error:', e);
    }
  });
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

/**
 * Reactive React Hook that triggers re-renders whenever the language changes.
 */
export function useLanguage() {
  const [lang, setLang] = useState(getLanguage());

  useEffect(() => {
    return onLanguageChange((newLang) => {
      setLang(newLang);
    });
  }, []);

  return {
    lang,
    t: (key, params) => t(key, params),
    setLanguage
  };
}
