import { createComponent, Types, defineComponents } from '@iwsdk/core';

export const SushiStation = createComponent('SushiStation', {
  stationType: { type: Types.String, default: '' },
  ingredient: { type: Types.String, default: '' },
});

export const ConveyorPlate = createComponent('ConveyorPlate', {
  speed: { type: Types.Float32, default: 0.3 },
  active: { type: Types.Boolean, default: false },
});

export const SushiItem = createComponent('SushiItem', {
  sushiType: { type: Types.String, default: '' },
  delivered: { type: Types.Boolean, default: false },
});

export const Bobbing = createComponent('Bobbing', {
  amplitude: { type: Types.Float32, default: 0.05 },
  speed: { type: Types.Float32, default: 2.0 },
  offset: { type: Types.Float32, default: 0 },
});

export const Particle = createComponent('Particle', {
  lifetime: { type: Types.Float32, default: 2.0 },
  age: { type: Types.Float32, default: 0 },
  velocityY: { type: Types.Float32, default: 0.5 },
});

export default defineComponents([
  SushiStation,
  ConveyorPlate,
  SushiItem,
  Bobbing,
  Particle,
]);
