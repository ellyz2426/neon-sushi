import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import {
  AudioSystem,
  EnvironmentSystem,
  GameSystem,
  UISystem,
  StationInteractionSystem,
} from './systems/game-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(AudioSystem);
  world.registerSystem(EnvironmentSystem);
  world.registerSystem(GameSystem);
  world.registerSystem(UISystem);
  world.registerSystem(StationInteractionSystem);
});
