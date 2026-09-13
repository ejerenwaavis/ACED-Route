import { registerPlugin } from '@capacitor/core';
import type { AcedRoutingPlugin } from './definitions';

const AcedRouting = registerPlugin<AcedRoutingPlugin>('AcedRouting', {
  web: () => import('./web').then((m) => new m.AcedRoutingWeb()),
});

export * from './definitions';
export { AcedRouting };
