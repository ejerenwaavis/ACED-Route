import { WebPlugin } from '@capacitor/core';
export class AcedRoutingWeb extends WebPlugin {
    constructor() {
        super(...arguments);
        this.watchId = null;
    }
    async checkRegionAvailable(options) {
        console.warn(`[AcedRoutingWeb] checkRegionAvailable for "${options.region}": offline routing is unavailable in browser environment.`);
        return { available: false, sizeMB: 0 };
    }
    async downloadRegionData(options) {
        throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
    }
    async deleteRegionData(options) {
        console.warn(`[AcedRoutingWeb] deleteRegionData for "${options.regionName}": no-op in browser.`);
        return { success: false };
    }
    async calculateRoute(options) {
        throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
    }
    async startNavigationTracking() {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            console.warn('[AcedRoutingWeb] Geolocation not supported');
            return;
        }
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        this.watchId = navigator.geolocation.watchPosition((pos) => {
            this.notifyListeners('locationUpdate', {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                altitude: pos.coords.altitude ?? undefined,
                bearing: pos.coords.heading ?? 0,
                speed: pos.coords.speed ?? 0,
                time: pos.timestamp,
            });
        }, (err) => {
            console.warn('[AcedRoutingWeb] Geolocation error:', err);
        }, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000,
        });
    }
    async stopNavigationTracking() {
        if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }
    async speak(options) {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
            return;
        }
        const { text, language = 'en', rate = 1.0, pitch = 1.0 } = options;
        window.speechSynthesis.cancel(); // Stop prior speech
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.pitch = pitch;
        const targetLang = language.toLowerCase().startsWith('es') ? 'es-US' : 'en-US';
        utterance.lang = targetLang;
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
            // Look for natural or Google voices in target language
            const best = voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)) &&
                (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Neural'))) || voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)));
            if (best) {
                utterance.voice = best;
            }
        }
        window.speechSynthesis.speak(utterance);
    }
    async stopSpeech() {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }
}
