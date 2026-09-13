import { registerPlugin } from '@capacitor/core';

const AcedRouting = registerPlugin('AcedRouting', {
  web: () => import('./web').then((m) => new m.AcedRoutingWeb()),
});

export * from './definitions';
export { AcedRouting };
