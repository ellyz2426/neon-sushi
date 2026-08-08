import {
  World,
  UIKitMLAsset,
  createSystem,
  Types,
  InputComponent,
  Hovered,
  Pressed,
  RayInteractable,
  ScreenSpace,
  Follower,
  Vector3,
  BoxGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  Mesh,
  Group,
  Object3D,
  PointLight,
  AmbientLight,
  DirectionalLight,
  Color,
  MathUtils,
  PlaneGeometry,
  RingGeometry,
  DoubleSide,
  MeshBasicMaterial,
  AdditiveBlending,
} from '@iwsdk/core';

// ============================================================
// Types & Data
// ============================================================

interface SushiRecipe {
  name: string;
  displayName: string;
  steps: string[];
  points: number;
  difficulty: number;
}

const RECIPES: Record<string, SushiRecipe> = {
  sashimi: {
    name: 'sashimi',
    displayName: 'SASHIMI',
    steps: ['fish'],
    points: 80,
    difficulty: 1,
  },
  nigiri: {
    name: 'nigiri',
    displayName: 'NIGIRI',
    steps: ['rice', 'fish'],
    points: 100,
    difficulty: 1,
  },
  maki: {
    name: 'maki',
    displayName: 'MAKI ROLL',
    steps: ['nori', 'rice', 'fish'],
    points: 150,
    difficulty: 2,
  },
  temaki: {
    name: 'temaki',
    displayName: 'TEMAKI',
    steps: ['nori', 'rice', 'fish', 'topping'],
    points: 250,
    difficulty: 3,
  },
};

const FISH_TYPES = ['salmon', 'tuna', 'shrimp', 'eel'];
const TOPPING_TYPES = ['wasabi', 'ginger', 'roe'];

const FISH_COLORS: Record<string, number> = {
  salmon: 0xff7744,
  tuna: 0xcc2222,
  shrimp: 0xffaa88,
  eel: 0x886633,
};

const TOPPING_COLORS: Record<string, number> = {
  wasabi: 0x88cc44,
  ginger: 0xffccaa,
  roe: 0xff6600,
};

interface Order {
  recipe: SushiRecipe;
  fish: string;
  topping: string;
  timeLimit: number;
  timeRemaining: number;
  isRush: boolean;
  isGolden: boolean;
  completed: boolean;
}

interface GameState {
  phase: 'menu' | 'playing' | 'wave-complete' | 'game-over' | 'paused' | 'settings' | 'recipe';
  score: number;
  highScore: number;
  wave: number;
  lives: number;
  combo: number;
  bestCombo: number;
  streak: number;
  bestStreak: number;
  sushiServed: number;
  ordersFailed: number;
  totalOrders: number;
  currentOrder: Order | null;
  orderQueue: Order[];
  currentStepIndex: number;
  difficulty: number; // 0=easy, 1=normal, 2=hard
  sfxEnabled: boolean;
  musicEnabled: boolean;
  waveOrdersTotal: number;
  waveOrdersCompleted: number;
  assemblyIngredients: string[];
  waveTimer: number;
}

// ============================================================
// Module-level refs (cross-system communication)
// ============================================================

interface SystemRefs {
  game: GameSystem | null;
  environment: EnvironmentSystem | null;
  audio: AudioSystem | null;
  ui: UISystem | null;
}

const systemRefs: SystemRefs = {
  game: null,
  environment: null,
  audio: null,
  ui: null,
};

// ============================================================
// Audio System
// ============================================================

export class AudioSystem extends createSystem({}) {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicOsc: OscillatorNode | null = null;
  private musicLfo: OscillatorNode | null = null;
  private sfxEnabled = true;
  private musicEnabled = true;
  private musicStarted = false;

  init() {
    systemRefs.audio = this;
  }

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.08;
      this.musicGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  setSfxEnabled(v: boolean) { this.sfxEnabled = v; }
  setMusicEnabled(v: boolean) {
    this.musicEnabled = v;
    if (this.musicGain) {
      this.musicGain.gain.value = v ? 0.08 : 0;
    }
    if (v && !this.musicStarted) this.startMusic();
  }

  startMusic() {
    const ctx = this.ensureCtx();
    if (this.musicStarted) return;
    this.musicStarted = true;

    // Japanese-inspired ambient pentatonic loop
    const playNote = (freq: number, startTime: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
      osc.connect(gain);
      gain.connect(this.musicGain!);
      osc.start(startTime);
      osc.stop(startTime + dur);
    };

    // Pentatonic scale notes (Japanese feel)
    const scale = [261.63, 293.66, 349.23, 392.0, 523.25, 587.33, 698.46];
    const loopDuration = 8;

    const scheduleLoop = () => {
      if (!this.musicEnabled) return;
      const now = ctx.currentTime;
      for (let i = 0; i < 8; i++) {
        const noteIdx = Math.floor(Math.random() * scale.length);
        const t = now + i * 1.0 + Math.random() * 0.2;
        playNote(scale[noteIdx], t, 1.5 + Math.random());
      }
      setTimeout(() => scheduleLoop(), loopDuration * 1000);
    };
    scheduleLoop();
  }

  stopMusic() {
    this.musicStarted = false;
  }

  playChop() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    // Short noise burst for chop
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    source.start(now);
  }

  playServe() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    // Pleasant chime for serving
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.4);
    });
  }

  playFail() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(100, now + 0.3);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playClick() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playCombo() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.06);
      gain.gain.linearRampToValueAtTime(0.2, now + i * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.25);
    });
  }

  playWaveComplete() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.25, now + i * 0.12 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.6);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.6);
    });
  }

  playGolden() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    [784, 988, 1175, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.1 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.5);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.5);
    });
  }

  playSplash() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureCtx();
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.15;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 8) * 0.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    source.start(now);
  }
}

// ============================================================
// Environment System
// ============================================================

export class EnvironmentSystem extends createSystem({}) {
  private conveyorBelt: Group | null = null;
  private conveyorPlates: Mesh[] = [];
  private conveyorTime = 0;
  private stationMeshes: Map<string, Mesh> = new Map();
  private stationGlows: Map<string, PointLight> = new Map();
  private particles: { mesh: Mesh; vy: number; age: number; lifetime: number }[] = [];
  private steamParticles: { mesh: Mesh; vy: number; age: number; lifetime: number; vx: number }[] = [];
  private lanternLights: PointLight[] = [];
  private lanternTime = 0;
  private assemblyBoard: Group | null = null;
  private assemblyItems: Mesh[] = [];
  private deliveredSushi: { mesh: Group; angle: number }[] = [];
  private sushiOnBelt: { group: Group; t: number }[] = [];
  private chopstickL: Mesh | null = null;
  private chopstickR: Mesh | null = null;
  private neonSigns: Mesh[] = [];
  private customers: { group: Group; bobPhase: number }[] = [];
  private scorePopups: { mesh: Mesh; age: number; vy: number }[] = [];
  private stationLabels: Map<string, Mesh> = new Map();

  init() {
    systemRefs.environment = this;
    this.buildRestaurant();
  }

  private buildRestaurant() {
    const scene = this.world.scene;

    // Floor — dark wood planks
    const floorGeo = new PlaneGeometry(12, 12);
    const floorMat = new MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.9 });
    const floor = new Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Back wall
    const wallGeo = new PlaneGeometry(12, 5);
    const wallMat = new MeshStandardMaterial({ color: 0x1a0a06, roughness: 0.85 });
    const backWall = new Mesh(wallGeo, wallMat);
    backWall.position.set(0, 2.5, -3);
    backWall.receiveShadow = true;
    scene.add(backWall);

    // Side walls
    const sideWallL = new Mesh(wallGeo, wallMat);
    sideWallL.position.set(-6, 2.5, 0);
    sideWallL.rotation.y = Math.PI / 2;
    scene.add(sideWallL);

    const sideWallR = new Mesh(wallGeo, wallMat);
    sideWallR.position.set(6, 2.5, 0);
    sideWallR.rotation.y = -Math.PI / 2;
    scene.add(sideWallR);

    // Ceiling
    const ceilingGeo = new PlaneGeometry(12, 12);
    const ceilingMat = new MeshStandardMaterial({ color: 0x0d0604, roughness: 0.95 });
    const ceiling = new Mesh(ceilingGeo, ceilingMat);
    ceiling.position.y = 4;
    ceiling.rotation.x = Math.PI / 2;
    scene.add(ceiling);

    // Sushi counter — main work surface
    const counterGeo = new BoxGeometry(5, 0.1, 1.2);
    const counterMat = new MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.6 });
    const counter = new Mesh(counterGeo, counterMat);
    counter.position.set(0, 0.85, -0.8);
    counter.castShadow = true;
    counter.receiveShadow = true;
    scene.add(counter);

    // Counter base
    const baseGeo = new BoxGeometry(5, 0.85, 1.2);
    const baseMat = new MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.8 });
    const base = new Mesh(baseGeo, baseMat);
    base.position.set(0, 0.425, -0.8);
    scene.add(base);

    // Build conveyor belt
    this.buildConveyor(scene);

    // Build ingredient stations
    this.buildStations(scene);

    // Assembly cutting board
    this.buildAssemblyBoard(scene);

    // Decorative elements
    this.buildDecorations(scene);

    // Lighting
    this.buildLighting(scene);

    // Customers sitting at the counter
    this.buildCustomers(scene);

    // Station labels (floating text indicators)
    this.buildStationLabels(scene);

    // Bonsai tree decoration
    this.buildBonsai(scene);

    // Tatami floor pattern
    this.buildTatamiFloor(scene);

    // Shoji screens
    this.buildShojiScreens(scene);

    // Koi pond
    this.buildKoiPond(scene);
  }

  private buildConveyor(scene: Object3D) {
    this.conveyorBelt = new Group();
    scene.add(this.conveyorBelt);

    // Conveyor track — curved track around counter
    const trackMat = new MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.6 });

    // Straight section in front
    const trackFront = new Mesh(new BoxGeometry(4.5, 0.06, 0.4), trackMat);
    trackFront.position.set(0, 0.92, -0.2);
    this.conveyorBelt.add(trackFront);

    // Track rails
    const railMat = new MeshStandardMaterial({ color: 0x666666, metalness: 0.8 });
    const railGeo = new BoxGeometry(4.8, 0.04, 0.04);
    const railF = new Mesh(railGeo, railMat);
    railF.position.set(0, 0.94, 0.0);
    this.conveyorBelt.add(railF);
    const railB = new Mesh(railGeo, railMat);
    railB.position.set(0, 0.94, -0.4);
    this.conveyorBelt.add(railB);

    // Moving plates on conveyor (decorative motion indicators)
    const plateMat = new MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.7 });
    for (let i = 0; i < 12; i++) {
      const plate = new Mesh(new BoxGeometry(0.3, 0.02, 0.3), plateMat);
      plate.position.set(-2.2 + i * 0.4, 0.93, -0.2);
      this.conveyorBelt.add(plate);
      this.conveyorPlates.push(plate);
    }
  }

  private buildStations(scene: Object3D) {
    const stations = [
      { name: 'rice', x: -1.8, color: 0xffffff, label: 'RICE' },
      { name: 'nori', x: -0.9, color: 0x1a3a1a, label: 'NORI' },
      { name: 'fish', x: 0.0, color: 0xff6644, label: 'FISH' },
      { name: 'topping', x: 0.9, color: 0x88cc44, label: 'TOPPING' },
      { name: 'serve', x: 1.8, color: 0xffdd44, label: 'SERVE' },
    ];

    stations.forEach((station) => {
      const group = new Group();
      group.position.set(station.x, 0, -1.6);

      // Station bowl/container
      const bowlGeo = new CylinderGeometry(0.15, 0.12, 0.12, 16);
      const bowlMat = new MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.3,
        metalness: 0.6,
      });
      const bowl = new Mesh(bowlGeo, bowlMat);
      bowl.position.y = 0.96;
      group.add(bowl);

      // Ingredient fill
      const fillGeo = new CylinderGeometry(0.13, 0.13, 0.06, 16);
      const fillMat = new MeshStandardMaterial({
        color: station.color,
        roughness: 0.6,
        emissive: station.color,
        emissiveIntensity: 0.15,
      });
      const fill = new Mesh(fillGeo, fillMat);
      fill.position.y = 1.0;
      group.add(fill);

      // Glow light under station
      const glow = new PointLight(station.color, 0.3, 0.8);
      glow.position.y = 1.05;
      group.add(glow);
      this.stationGlows.set(station.name, glow);

      scene.add(group);
      this.stationMeshes.set(station.name, fill);

      // Create clickable entity for this station
      const entity = this.world.createTransformEntity(group);
      entity.addComponent(RayInteractable, {});
    });
  }

  private buildAssemblyBoard(scene: Object3D) {
    this.assemblyBoard = new Group();
    this.assemblyBoard.position.set(0, 0.91, -0.8);

    // Wooden cutting board
    const boardGeo = new BoxGeometry(0.5, 0.03, 0.3);
    const boardMat = new MeshStandardMaterial({ color: 0x8B7355, roughness: 0.7 });
    const board = new Mesh(boardGeo, boardMat);
    this.assemblyBoard.add(board);

    // Chopsticks decoration
    const chopGeo = new CylinderGeometry(0.008, 0.004, 0.25, 6);
    const chopMat = new MeshStandardMaterial({ color: 0x4a3520, roughness: 0.5 });

    this.chopstickL = new Mesh(chopGeo, chopMat);
    this.chopstickL.position.set(0.3, 0.03, 0.0);
    this.chopstickL.rotation.z = Math.PI / 2;
    this.chopstickL.rotation.y = 0.1;
    this.assemblyBoard.add(this.chopstickL);

    this.chopstickR = new Mesh(chopGeo, chopMat);
    this.chopstickR.position.set(0.3, 0.03, 0.05);
    this.chopstickR.rotation.z = Math.PI / 2;
    this.chopstickR.rotation.y = -0.1;
    this.assemblyBoard.add(this.chopstickR);

    scene.add(this.assemblyBoard);
  }

  private buildDecorations(scene: Object3D) {
    // Paper lanterns
    const lanternColors = [0xff3322, 0xff6644, 0xffaa44];
    for (let i = 0; i < 5; i++) {
      const lanternGroup = new Group();
      const x = -4 + i * 2;
      lanternGroup.position.set(x, 3.2, -2.5);

      // Lantern body (sphere)
      const lanternGeo = new SphereGeometry(0.18, 12, 8);
      const lanternMat = new MeshStandardMaterial({
        color: lanternColors[i % 3],
        roughness: 0.8,
        emissive: lanternColors[i % 3],
        emissiveIntensity: 0.4,
      });
      const lantern = new Mesh(lanternGeo, lanternMat);
      lanternGroup.add(lantern);

      // String
      const stringGeo = new CylinderGeometry(0.005, 0.005, 0.6, 4);
      const stringMat = new MeshStandardMaterial({ color: 0x444444 });
      const string = new Mesh(stringGeo, stringMat);
      string.position.y = 0.48;
      lanternGroup.add(string);

      // Lantern light
      const light = new PointLight(lanternColors[i % 3], 0.4, 3);
      light.position.y = 0;
      lanternGroup.add(light);
      this.lanternLights.push(light);

      scene.add(lanternGroup);
    }

    // Noren curtain (entrance divider) — simplified as hanging panels
    const norenMat = new MeshStandardMaterial({
      color: 0x1a0a2e,
      roughness: 0.9,
      side: DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const norenGeo = new PlaneGeometry(0.4, 1.5);
      const noren = new Mesh(norenGeo, norenMat);
      noren.position.set(-0.8 + i * 0.5, 3.2, 3);
      scene.add(noren);
    }

    // Bamboo mats on walls
    const bambooMat = new MeshStandardMaterial({ color: 0x8B7355, roughness: 0.85 });
    for (let i = 0; i < 3; i++) {
      const mat = new Mesh(new PlaneGeometry(1.2, 0.8), bambooMat);
      mat.position.set(-3 + i * 3, 2.8, -2.98);
      scene.add(mat);
    }

    // Fish display case (glass-like)
    const caseGeo = new BoxGeometry(1.5, 0.5, 0.4);
    const caseMat = new MeshStandardMaterial({
      color: 0x88ccff,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.15,
    });
    const displayCase = new Mesh(caseGeo, caseMat);
    displayCase.position.set(-2.5, 1.2, -2.7);
    scene.add(displayCase);

    // Decorative fish models inside case
    const fishDisplayMat = new MeshStandardMaterial({ color: 0xff6644, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const fishGeo = new SphereGeometry(0.08, 8, 6);
      fishGeo.scale(2, 0.6, 0.8);
      const fish = new Mesh(fishGeo, fishDisplayMat.clone());
      (fish.material as MeshStandardMaterial).color.setHex(
        [0xff7744, 0xcc2222, 0xffaa88][i]
      );
      fish.position.set(-2.8 + i * 0.35, 1.15, -2.7);
      scene.add(fish);
    }

    // Sake bottles on shelf
    const bottleMat = new MeshStandardMaterial({ color: 0x335544, roughness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const bottleGroup = new Group();
      const bottleBody = new Mesh(new CylinderGeometry(0.04, 0.04, 0.2, 8), bottleMat);
      const bottleNeck = new Mesh(new CylinderGeometry(0.02, 0.03, 0.08, 8), bottleMat);
      bottleNeck.position.y = 0.14;
      bottleGroup.add(bottleBody);
      bottleGroup.add(bottleNeck);
      bottleGroup.position.set(2 + i * 0.15, 1.6, -2.85);
      scene.add(bottleGroup);
    }

    // Neon sign on back wall — "SUSHI"
    const neonMat = new MeshBasicMaterial({
      color: 0xff4433,
      transparent: true,
      opacity: 0.9,
    });
    const neonBorder = new Mesh(
      new TorusGeometry(0.5, 0.02, 8, 32),
      neonMat
    );
    neonBorder.position.set(0, 2.8, -2.95);
    scene.add(neonBorder);
    this.neonSigns.push(neonBorder);

    // Tea cups on counter for customers
    const teaMat = new MeshStandardMaterial({ color: 0x336655, roughness: 0.3 });
    const teaLiquid = new MeshStandardMaterial({
      color: 0x88aa44,
      roughness: 0.2,
      emissive: 0x445522,
      emissiveIntensity: 0.1,
    });
    for (let i = 0; i < 3; i++) {
      const cupGroup = new Group();
      const cup = new Mesh(new CylinderGeometry(0.025, 0.02, 0.04, 10), teaMat);
      const liquid = new Mesh(new CylinderGeometry(0.022, 0.022, 0.005, 10), teaLiquid);
      liquid.position.y = 0.018;
      cupGroup.add(cup);
      cupGroup.add(liquid);
      cupGroup.position.set(-1.2 + i * 1.2, 0.91, -0.3);
      scene.add(cupGroup);
    }

    // Wall scroll decorations (vertical scrolls on back wall)
    const scrollMat = new MeshStandardMaterial({
      color: 0xeeddcc,
      roughness: 0.85,
      side: DoubleSide,
    });
    const scrollBorderMat = new MeshStandardMaterial({ color: 0x4a3520, roughness: 0.7 });
    for (let i = 0; i < 2; i++) {
      const scrollGroup = new Group();
      scrollGroup.position.set(i === 0 ? -1.5 : 1.5, 2.2, -2.97);

      // Scroll body
      const scrollBody = new Mesh(new PlaneGeometry(0.3, 0.8), scrollMat);
      scrollGroup.add(scrollBody);

      // Top roller
      const roller = new Mesh(new CylinderGeometry(0.015, 0.015, 0.34, 8), scrollBorderMat);
      roller.rotation.z = Math.PI / 2;
      roller.position.y = 0.4;
      scrollGroup.add(roller);

      // Bottom weight
      const weight = new Mesh(new CylinderGeometry(0.012, 0.012, 0.32, 8), scrollBorderMat);
      weight.rotation.z = Math.PI / 2;
      weight.position.y = -0.4;
      scrollGroup.add(weight);

      // Decorative circle (kanji placeholder)
      const kanji = new Mesh(
        new RingGeometry(0.06, 0.08, 16),
        new MeshStandardMaterial({
          color: 0x332222,
          side: DoubleSide,
        })
      );
      kanji.position.z = 0.001;
      scrollGroup.add(kanji);

      scene.add(scrollGroup);
    }

    // Ceiling beams (dark wood)
    const beamMat = new MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const beam = new Mesh(new BoxGeometry(12, 0.08, 0.12), beamMat);
      beam.position.set(0, 3.9, -3 + i * 2);
      scene.add(beam);
    }
  }

  private buildLighting(scene: Object3D) {
    // Warm ambient
    const ambient = new AmbientLight(0x331a0e, 0.4);
    scene.add(ambient);

    // Main overhead warm light
    const mainLight = new DirectionalLight(0xffcc88, 0.6);
    mainLight.position.set(0, 4, 0);
    mainLight.castShadow = true;
    scene.add(mainLight);

    // Counter spotlight
    const counterLight = new PointLight(0xffaa66, 0.8, 4);
    counterLight.position.set(0, 2.5, -0.8);
    counterLight.castShadow = true;
    scene.add(counterLight);

    // Red accent lights
    const accentL = new PointLight(0xff3322, 0.3, 5);
    accentL.position.set(-3, 2, -1);
    scene.add(accentL);

    const accentR = new PointLight(0xff3322, 0.3, 5);
    accentR.position.set(3, 2, -1);
    scene.add(accentR);
  }

  private buildCustomers(scene: Object3D) {
    // Customer silhouettes sitting across the counter
    const customerPositions = [
      { x: -1.5, z: 0.8 },
      { x: 0, z: 1.0 },
      { x: 1.5, z: 0.8 },
    ];
    const customerColors = [0x443322, 0x332244, 0x223344];

    customerPositions.forEach((pos, i) => {
      const group = new Group();
      group.position.set(pos.x, 0, pos.z);

      // Body
      const bodyMat = new MeshStandardMaterial({ color: customerColors[i], roughness: 0.8 });
      const torso = new Mesh(new CylinderGeometry(0.15, 0.12, 0.5, 8), bodyMat);
      torso.position.y = 0.9;
      group.add(torso);

      // Head
      const head = new Mesh(new SphereGeometry(0.1, 10, 8), bodyMat);
      head.position.y = 1.25;
      group.add(head);

      // Arms resting on counter
      const armMat = new MeshStandardMaterial({ color: customerColors[i], roughness: 0.8 });
      const armL = new Mesh(new CylinderGeometry(0.03, 0.03, 0.3, 6), armMat);
      armL.position.set(-0.15, 0.85, -0.1);
      armL.rotation.z = Math.PI / 3;
      group.add(armL);
      const armR = new Mesh(new CylinderGeometry(0.03, 0.03, 0.3, 6), armMat);
      armR.position.set(0.15, 0.85, -0.1);
      armR.rotation.z = -Math.PI / 3;
      group.add(armR);

      // Stool
      const stoolSeat = new Mesh(
        new CylinderGeometry(0.15, 0.15, 0.04, 12),
        new MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.6 })
      );
      stoolSeat.position.y = 0.55;
      group.add(stoolSeat);
      const stoolLeg = new Mesh(
        new CylinderGeometry(0.03, 0.04, 0.55, 6),
        new MeshStandardMaterial({ color: 0x333333, metalness: 0.5 })
      );
      stoolLeg.position.y = 0.275;
      group.add(stoolLeg);

      scene.add(group);
      this.customers.push({ group, bobPhase: i * 2.1 });
    });
  }

  private buildStationLabels(scene: Object3D) {
    // Floating indicator lights above each station
    const stations = [
      { name: 'rice', x: -1.8, color: 0xffffff },
      { name: 'nori', x: -0.9, color: 0x44aa44 },
      { name: 'fish', x: 0.0, color: 0xff6644 },
      { name: 'topping', x: 0.9, color: 0x88cc44 },
      { name: 'serve', x: 1.8, color: 0xffdd44 },
    ];

    stations.forEach((station, i) => {
      // Small glowing indicator sphere above station
      const indicator = new Mesh(
        new SphereGeometry(0.04, 8, 6),
        new MeshBasicMaterial({
          color: station.color,
          transparent: true,
          opacity: 0.8,
        })
      );
      indicator.position.set(station.x, 1.2, -1.6);
      scene.add(indicator);
      this.stationLabels.set(station.name, indicator);

      // Key number indicator for browser mode (small ring)
      const ring = new Mesh(
        new RingGeometry(0.03, 0.05, 16),
        new MeshBasicMaterial({
          color: station.color,
          transparent: true,
          opacity: 0.5,
          side: DoubleSide,
        })
      );
      ring.position.set(station.x, 1.15, -1.58);
      scene.add(ring);
    });
  }

  private buildBonsai(scene: Object3D) {
    const bonsaiGroup = new Group();
    bonsaiGroup.position.set(2.8, 1.1, -2.7);

    // Pot
    const pot = new Mesh(
      new CylinderGeometry(0.08, 0.06, 0.08, 12),
      new MeshStandardMaterial({ color: 0x6b3a2a, roughness: 0.7 })
    );
    bonsaiGroup.add(pot);

    // Trunk
    const trunk = new Mesh(
      new CylinderGeometry(0.015, 0.02, 0.15, 6),
      new MeshStandardMaterial({ color: 0x4a3520, roughness: 0.8 })
    );
    trunk.position.y = 0.11;
    trunk.rotation.z = 0.15;
    bonsaiGroup.add(trunk);

    // Foliage clusters
    const foliageMat = new MeshStandardMaterial({
      color: 0x2a6a2a,
      roughness: 0.9,
      emissive: 0x1a3a1a,
      emissiveIntensity: 0.1,
    });
    const positions = [
      [0.02, 0.2, 0],
      [-0.04, 0.18, 0.02],
      [0.05, 0.22, -0.01],
      [0.0, 0.25, 0.01],
    ];
    positions.forEach(([x, y, z]) => {
      const leaf = new Mesh(new SphereGeometry(0.04, 8, 6), foliageMat);
      leaf.position.set(x, y, z);
      leaf.scale.set(1.2, 0.6, 1.0);
      bonsaiGroup.add(leaf);
    });

    scene.add(bonsaiGroup);
  }

  private buildTatamiFloor(scene: Object3D) {
    // Replace plain floor with tatami-style pattern
    const tatamiMat = new MeshStandardMaterial({ color: 0x2a1e10, roughness: 0.85 });
    const borderMat = new MeshStandardMaterial({ color: 0x1a0e06, roughness: 0.9 });

    // Tatami mat tiles
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        const mat = new Mesh(new BoxGeometry(1.8, 0.01, 0.9), tatamiMat);
        mat.position.set(col * 2.0, 0.005, row * 1.0 + 2.0);
        if ((row + col) % 2 === 0) mat.rotation.y = Math.PI / 2;
        scene.add(mat);

        // Border strip
        const border = new Mesh(new BoxGeometry(1.82, 0.012, 0.03), borderMat);
        border.position.set(col * 2.0, 0.006, row * 1.0 + 2.0 + 0.45);
        if ((row + col) % 2 === 0) border.rotation.y = Math.PI / 2;
        scene.add(border);
      }
    }
  }

  private buildShojiScreens(scene: Object3D) {
    // Shoji screen partitions on sides
    const frameMat = new MeshStandardMaterial({ color: 0x4a3520, roughness: 0.7 });
    const paperMat = new MeshStandardMaterial({
      color: 0xeee8d5,
      roughness: 0.95,
      transparent: true,
      opacity: 0.25,
      emissive: 0xffeecc,
      emissiveIntensity: 0.1,
      side: DoubleSide,
    });

    // Left screen
    for (let i = 0; i < 3; i++) {
      const screenGroup = new Group();
      screenGroup.position.set(-5.5, 0, -1 + i * 1.5);

      // Frame
      const topBar = new Mesh(new BoxGeometry(1.2, 0.03, 0.03), frameMat);
      topBar.position.y = 2.5;
      screenGroup.add(topBar);

      const bottomBar = new Mesh(new BoxGeometry(1.2, 0.03, 0.03), frameMat);
      bottomBar.position.y = 0.3;
      screenGroup.add(bottomBar);

      const leftPost = new Mesh(new BoxGeometry(0.03, 2.2, 0.03), frameMat);
      leftPost.position.set(-0.6, 1.4, 0);
      screenGroup.add(leftPost);

      const rightPost = new Mesh(new BoxGeometry(0.03, 2.2, 0.03), frameMat);
      rightPost.position.set(0.6, 1.4, 0);
      screenGroup.add(rightPost);

      // Paper
      const paper = new Mesh(new PlaneGeometry(1.14, 2.14), paperMat);
      paper.position.set(0, 1.4, 0);
      paper.rotation.y = Math.PI / 2;
      screenGroup.add(paper);

      // Cross members
      const crossH = new Mesh(new BoxGeometry(1.14, 0.015, 0.015), frameMat);
      crossH.position.set(0, 1.4, 0);
      screenGroup.add(crossH);

      const crossV = new Mesh(new BoxGeometry(0.015, 2.14, 0.015), frameMat);
      crossV.position.set(0, 1.4, 0);
      screenGroup.add(crossV);

      scene.add(screenGroup);
    }
  }

  private buildKoiPond(scene: Object3D) {
    // Small decorative koi pond in the corner
    const pondGroup = new Group();
    pondGroup.position.set(-3.5, 0.01, 2.5);

    // Pond base (dark)
    const pondBase = new Mesh(
      new CylinderGeometry(0.5, 0.5, 0.02, 24),
      new MeshStandardMaterial({
        color: 0x1a3344,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.7,
      })
    );
    pondGroup.add(pondBase);

    // Pond rim (stone)
    const rim = new Mesh(
      new TorusGeometry(0.5, 0.04, 8, 24),
      new MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    pondGroup.add(rim);

    // Lily pads
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + 0.3;
      const r = 0.2 + Math.random() * 0.15;
      const lily = new Mesh(
        new CylinderGeometry(0.06, 0.06, 0.005, 12),
        new MeshStandardMaterial({
          color: 0x2a6a2a,
          roughness: 0.8,
        })
      );
      lily.position.set(Math.cos(angle) * r, 0.015, Math.sin(angle) * r);
      pondGroup.add(lily);
    }

    // Koi fish (small colored shapes)
    const koiColors = [0xff6622, 0xffcc44, 0xffffff];
    for (let i = 0; i < 3; i++) {
      const koi = new Mesh(
        new SphereGeometry(0.02, 6, 4),
        new MeshStandardMaterial({
          color: koiColors[i],
          emissive: koiColors[i],
          emissiveIntensity: 0.2,
        })
      );
      koi.scale.set(2, 0.5, 0.8);
      const angle = (i / 3) * Math.PI * 2;
      koi.position.set(Math.cos(angle) * 0.25, 0.01, Math.sin(angle) * 0.25);
      koi.rotation.y = angle + Math.PI / 2;
      pondGroup.add(koi);
    }

    // Pond light
    const pondLight = new PointLight(0x44aaff, 0.2, 2);
    pondLight.position.y = 0.1;
    pondGroup.add(pondLight);

    scene.add(pondGroup);
  }

  spawnScorePopup(x: number, y: number, z: number, points: number) {
    // Visual floating score indicator
    const color = points >= 500 ? 0xffdd44 : points >= 200 ? 0x44ddff : 0x44ff88;
    const popup = new Mesh(
      new SphereGeometry(0.03, 8, 6),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      })
    );
    popup.position.set(x, y, z);
    // Scale based on points
    const scale = 0.5 + Math.min(points / 500, 1.5);
    popup.scale.setScalar(scale);
    this.world.scene.add(popup);
    this.scorePopups.push({ mesh: popup, age: 0, vy: 0.8 });
  }

  customerReact(happy: boolean) {
    // Make customers bob when sushi is served
    this.customers.forEach((c) => {
      if (happy) {
        c.bobPhase = 0; // Reset bob for visible reaction
      }
    });
  }

  animateChopsticks() {
    // Quick chopstick crossing animation
    if (!this.chopstickL || !this.chopstickR) return;
    const origLY = 0.1;
    const origRY = -0.1;
    this.chopstickL.rotation.y = 0.3;
    this.chopstickR.rotation.y = -0.3;
    setTimeout(() => {
      if (this.chopstickL) this.chopstickL.rotation.y = origLY;
      if (this.chopstickR) this.chopstickR.rotation.y = origRY;
    }, 150);
  }

  highlightStation(name: string, active: boolean) {
    const glow = this.stationGlows.get(name);
    if (glow) {
      glow.intensity = active ? 1.5 : 0.3;
    }
    const mesh = this.stationMeshes.get(name);
    if (mesh) {
      const mat = mesh.material as MeshStandardMaterial;
      mat.emissiveIntensity = active ? 0.6 : 0.15;
    }
  }

  addIngredientToBoard(ingredient: string, index: number) {
    if (!this.assemblyBoard) return;

    let geo: BoxGeometry | CylinderGeometry | SphereGeometry;
    let color: number;

    switch (ingredient) {
      case 'rice':
        geo = new CylinderGeometry(0.06, 0.06, 0.03, 12);
        color = 0xffffff;
        break;
      case 'nori':
        geo = new BoxGeometry(0.12, 0.005, 0.08);
        color = 0x1a3a1a;
        break;
      case 'fish': {
        geo = new BoxGeometry(0.08, 0.02, 0.04);
        // Use correct fish color based on current order
        const order = systemRefs.game?.state.currentOrder;
        color = order ? (FISH_COLORS[order.fish] ?? 0xff6644) : 0xff6644;
        break;
      }
      case 'topping': {
        geo = new SphereGeometry(0.02, 8, 6);
        const topOrder = systemRefs.game?.state.currentOrder;
        color = topOrder ? (TOPPING_COLORS[topOrder.topping] ?? 0x88cc44) : 0x88cc44;
        break;
      }
      default:
        geo = new BoxGeometry(0.05, 0.03, 0.05);
        color = 0xcccccc;
    }

    const mat = new MeshStandardMaterial({
      color,
      roughness: 0.5,
      emissive: color,
      emissiveIntensity: 0.1,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(-0.1 + index * 0.06, 0.03 + index * 0.025, 0);
    this.assemblyBoard.add(mesh);
    this.assemblyItems.push(mesh);
  }

  clearAssembly() {
    this.assemblyItems.forEach((m) => {
      this.assemblyBoard?.remove(m);
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    });
    this.assemblyItems = [];
  }

  serveSushi(recipeName: string) {
    // Create sushi model and put it on conveyor
    const sushiGroup = new Group();

    switch (recipeName) {
      case 'nigiri': {
        const riceBase = new Mesh(
          new CylinderGeometry(0.04, 0.035, 0.025, 12),
          new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
        );
        const fishTop = new Mesh(
          new BoxGeometry(0.07, 0.015, 0.035),
          new MeshStandardMaterial({ color: 0xff7744, roughness: 0.4 })
        );
        fishTop.position.y = 0.02;
        sushiGroup.add(riceBase);
        sushiGroup.add(fishTop);
        break;
      }
      case 'maki': {
        const roll = new Mesh(
          new CylinderGeometry(0.03, 0.03, 0.04, 12),
          new MeshStandardMaterial({ color: 0x1a3a1a, roughness: 0.5 })
        );
        roll.rotation.x = Math.PI / 2;
        const riceInner = new Mesh(
          new CylinderGeometry(0.025, 0.025, 0.041, 12),
          new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
        );
        riceInner.rotation.x = Math.PI / 2;
        const fishCenter = new Mesh(
          new CylinderGeometry(0.01, 0.01, 0.042, 8),
          new MeshStandardMaterial({ color: 0xff6644, roughness: 0.4 })
        );
        fishCenter.rotation.x = Math.PI / 2;
        sushiGroup.add(roll);
        sushiGroup.add(riceInner);
        sushiGroup.add(fishCenter);
        break;
      }
      case 'temaki': {
        const cone = new Mesh(
          new CylinderGeometry(0.005, 0.04, 0.08, 8),
          new MeshStandardMaterial({ color: 0x1a3a1a, roughness: 0.5 })
        );
        cone.rotation.z = -Math.PI / 6;
        const filling = new Mesh(
          new SphereGeometry(0.02, 8, 6),
          new MeshStandardMaterial({ color: 0xff7744, roughness: 0.4 })
        );
        filling.position.set(0, 0.04, 0);
        sushiGroup.add(cone);
        sushiGroup.add(filling);
        break;
      }
      case 'sashimi': {
        const slice1 = new Mesh(
          new BoxGeometry(0.06, 0.01, 0.03),
          new MeshStandardMaterial({ color: 0xff7744, roughness: 0.3 })
        );
        const slice2 = new Mesh(
          new BoxGeometry(0.06, 0.01, 0.03),
          new MeshStandardMaterial({ color: 0xff7744, roughness: 0.3 })
        );
        slice2.position.set(0.02, 0, 0.025);
        sushiGroup.add(slice1);
        sushiGroup.add(slice2);
        break;
      }
    }

    // Plate
    const plate = new Mesh(
      new CylinderGeometry(0.08, 0.07, 0.01, 16),
      new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.1 })
    );
    sushiGroup.add(plate);
    sushiGroup.position.set(0, 0.95, -0.2);

    this.world.scene.add(sushiGroup);
    this.sushiOnBelt.push({ group: sushiGroup, t: 0 });
  }

  spawnSteam(x: number, y: number, z: number) {
    const steamMat = new MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
    });
    for (let i = 0; i < 5; i++) {
      const steam = new Mesh(new SphereGeometry(0.02, 6, 4), steamMat.clone());
      steam.position.set(
        x + (Math.random() - 0.5) * 0.1,
        y,
        z + (Math.random() - 0.5) * 0.1
      );
      this.world.scene.add(steam);
      this.steamParticles.push({
        mesh: steam,
        vy: 0.3 + Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.1,
        age: 0,
        lifetime: 1.0 + Math.random() * 0.5,
      });
    }
  }

  update(delta: number) {
    this.conveyorTime += delta;
    this.lanternTime += delta;

    // Animate conveyor plates
    this.conveyorPlates.forEach((plate, i) => {
      const offset = (this.conveyorTime * 0.3 + i * 0.4) % 4.8;
      plate.position.x = -2.2 + offset;
    });

    // Animate lantern lights flicker
    this.lanternLights.forEach((light, i) => {
      light.intensity = 0.3 + Math.sin(this.lanternTime * 3 + i * 1.5) * 0.15;
    });

    // Animate sushi on belt (slide to the right and off)
    for (let i = this.sushiOnBelt.length - 1; i >= 0; i--) {
      const item = this.sushiOnBelt[i];
      item.t += delta * 0.2;
      item.group.position.x = -2 + item.t * 8;
      if (item.t > 1) {
        this.world.scene.remove(item.group);
        this.sushiOnBelt.splice(i, 1);
      }
    }

    // Animate steam particles
    for (let i = this.steamParticles.length - 1; i >= 0; i--) {
      const p = this.steamParticles[i];
      p.age += delta;
      p.mesh.position.y += p.vy * delta;
      p.mesh.position.x += p.vx * delta;
      const life = p.age / p.lifetime;
      const mat = p.mesh.material as MeshStandardMaterial;
      mat.opacity = 0.3 * (1 - life);
      p.mesh.scale.setScalar(1 + life * 2);
      if (p.age >= p.lifetime) {
        this.world.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        mat.dispose();
        this.steamParticles.splice(i, 1);
      }
    }

    // Neon sign pulse
    this.neonSigns.forEach((sign) => {
      const mat = sign.material as MeshBasicMaterial;
      mat.opacity = 0.7 + Math.sin(this.lanternTime * 2) * 0.3;
    });

    // Animate customers idle bobbing
    this.customers.forEach((c) => {
      c.bobPhase += delta * 1.5;
      const bob = Math.sin(c.bobPhase) * 0.015;
      c.group.children[1].position.y = 1.25 + bob; // head bobs
    });

    // Animate score popups
    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const p = this.scorePopups[i];
      p.age += delta;
      p.mesh.position.y += p.vy * delta;
      const mat = p.mesh.material as MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.9 * (1 - p.age / 1.2));
      p.mesh.scale.multiplyScalar(1 + delta * 0.5);
      if (p.age >= 1.2) {
        this.world.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        mat.dispose();
        this.scorePopups.splice(i, 1);
      }
    }

    // Pulse station labels for active station
    this.stationLabels.forEach((mesh, name) => {
      const mat = mesh.material as MeshBasicMaterial;
      const glow = this.stationGlows.get(name);
      if (glow && glow.intensity > 1.0) {
        mat.opacity = 0.5 + Math.sin(this.lanternTime * 6) * 0.4;
        mesh.scale.setScalar(1.0 + Math.sin(this.lanternTime * 6) * 0.2);
      } else {
        mat.opacity = 0.4;
        mesh.scale.setScalar(1.0);
      }
    });
  }

  flashServe() {
    // Quick flash of the counter light
    const scene = this.world.scene;
    const flash = new PointLight(0xffdd44, 2, 5);
    flash.position.set(0, 1.5, -0.5);
    scene.add(flash);
    let t = 0;
    const fade = () => {
      t += 0.016;
      flash.intensity = 2 * (1 - t / 0.3);
      if (t < 0.3) {
        requestAnimationFrame(fade);
      } else {
        scene.remove(flash);
        flash.dispose();
      }
    };
    requestAnimationFrame(fade);
  }
}

// ============================================================
// Game System
// ============================================================

export class GameSystem extends createSystem({}) {
  public state: GameState = {
    phase: 'menu',
    score: 0,
    highScore: 0,
    wave: 1,
    lives: 3,
    combo: 1,
    bestCombo: 1,
    streak: 0,
    bestStreak: 0,
    sushiServed: 0,
    ordersFailed: 0,
    totalOrders: 0,
    currentOrder: null,
    orderQueue: [],
    currentStepIndex: 0,
    difficulty: 1,
    sfxEnabled: true,
    musicEnabled: true,
    waveOrdersTotal: 0,
    waveOrdersCompleted: 0,
    assemblyIngredients: [],
    waveTimer: 0,
  };

  private stationEntities: Map<string, number> = new Map();

  init() {
    systemRefs.game = this;
    // Load high score
    try {
      const saved = localStorage.getItem('neon-sushi-highscore');
      if (saved) this.state.highScore = parseInt(saved, 10);
    } catch (_e) { /* ignore */ }
  }

  startGame() {
    this.state.phase = 'playing';
    this.state.score = 0;
    this.state.wave = 1;
    this.state.lives = this.state.difficulty === 0 ? 5 : this.state.difficulty === 1 ? 3 : 2;
    this.state.combo = 1;
    this.state.bestCombo = 1;
    this.state.streak = 0;
    this.state.bestStreak = 0;
    this.state.sushiServed = 0;
    this.state.ordersFailed = 0;
    this.state.totalOrders = 0;
    this.state.currentStepIndex = 0;
    this.state.assemblyIngredients = [];
    this.state.waveOrdersCompleted = 0;

    this.startWave();
    systemRefs.audio?.startMusic();
  }

  private startWave() {
    const wave = this.state.wave;
    const ordersInWave = 3 + Math.floor(wave * 1.5);
    this.state.waveOrdersTotal = ordersInWave;
    this.state.waveOrdersCompleted = 0;

    // Generate order queue
    this.state.orderQueue = [];
    for (let i = 0; i < ordersInWave; i++) {
      this.state.orderQueue.push(this.generateOrder());
    }

    this.nextOrder();
  }

  private generateOrder(): Order {
    const wave = this.state.wave;
    const diff = this.state.difficulty;

    // Determine available recipe types based on wave
    const available: string[] = ['sashimi', 'nigiri'];
    if (wave >= 2) available.push('maki');
    if (wave >= 4) available.push('temaki');

    const recipeName = available[Math.floor(Math.random() * available.length)];
    const recipe = RECIPES[recipeName];

    const fish = FISH_TYPES[Math.floor(Math.random() * Math.min(wave + 1, FISH_TYPES.length))];
    const topping = TOPPING_TYPES[Math.floor(Math.random() * TOPPING_TYPES.length)];

    // Time limit scales with difficulty and wave
    const baseTime = diff === 0 ? 35 : diff === 1 ? 25 : 18;
    const timeLimit = baseTime + recipe.steps.length * 3 - Math.min(wave * 0.5, 8);

    const isRush = wave > 1 && Math.random() < 0.12;
    const isGolden = wave > 2 && Math.random() < 0.1;

    return {
      recipe,
      fish,
      topping,
      timeLimit: isRush ? timeLimit * 0.6 : timeLimit,
      timeRemaining: isRush ? timeLimit * 0.6 : timeLimit,
      isRush,
      isGolden,
      completed: false,
    };
  }

  private nextOrder() {
    if (this.state.orderQueue.length === 0) {
      // Wave complete
      this.waveComplete();
      return;
    }

    this.state.currentOrder = this.state.orderQueue.shift()!;
    this.state.currentStepIndex = 0;
    this.state.assemblyIngredients = [];
    this.state.totalOrders++;

    systemRefs.environment?.clearAssembly();
    systemRefs.ui?.updateOrderPanel();
    this.highlightNextStation();
  }

  private highlightNextStation() {
    const order = this.state.currentOrder;
    if (!order) return;

    // Clear all highlights
    ['rice', 'nori', 'fish', 'topping', 'serve'].forEach((s) => {
      systemRefs.environment?.highlightStation(s, false);
    });

    if (this.state.currentStepIndex < order.recipe.steps.length) {
      const nextStep = order.recipe.steps[this.state.currentStepIndex];
      systemRefs.environment?.highlightStation(nextStep, true);
    } else {
      // All ingredients collected — highlight serve
      systemRefs.environment?.highlightStation('serve', true);
    }
  }

  handleStationClick(stationType: string) {
    if (this.state.phase !== 'playing' || !this.state.currentOrder) return;

    const order = this.state.currentOrder;

    if (stationType === 'serve') {
      // Check if all steps are done
      if (this.state.currentStepIndex >= order.recipe.steps.length) {
        this.completeOrder();
      }
      return;
    }

    // Check if this is the correct next ingredient
    if (this.state.currentStepIndex < order.recipe.steps.length) {
      const expectedStep = order.recipe.steps[this.state.currentStepIndex];
      if (stationType === expectedStep) {
        // Correct ingredient
        this.state.assemblyIngredients.push(stationType);
        systemRefs.environment?.addIngredientToBoard(stationType, this.state.currentStepIndex);
        systemRefs.audio?.playChop();
        systemRefs.environment?.animateChopsticks();
        this.state.currentStepIndex++;
        this.highlightNextStation();
        systemRefs.ui?.updateOrderPanel();

        // Auto-complete if all steps done
        if (this.state.currentStepIndex >= order.recipe.steps.length) {
          this.highlightNextStation();
        }
      } else {
        // Wrong ingredient — penalty
        systemRefs.audio?.playFail();
        this.state.combo = 1;
        this.state.streak = 0;
        systemRefs.ui?.updateHUD();
      }
    }
  }

  private completeOrder() {
    const order = this.state.currentOrder!;

    // Calculate score
    let points = order.recipe.points;
    const timeBonus = Math.floor(order.timeRemaining * 2);
    points += timeBonus;
    points *= this.state.combo;
    if (order.isGolden) {
      points = Math.floor(points * 2.5);
      systemRefs.audio?.playGolden();
    }
    if (order.isRush) {
      points = Math.floor(points * 1.5);
    }

    this.state.score += points;
    this.state.sushiServed++;
    this.state.combo = Math.min(this.state.combo + 1, 10);
    this.state.bestCombo = Math.max(this.state.bestCombo, this.state.combo);
    this.state.streak++;
    this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
    this.state.waveOrdersCompleted++;

    if (this.state.combo >= 3) {
      systemRefs.audio?.playCombo();
    } else {
      systemRefs.audio?.playServe();
    }

    systemRefs.environment?.serveSushi(order.recipe.name);
    systemRefs.environment?.flashServe();
    systemRefs.environment?.clearAssembly();
    systemRefs.environment?.spawnSteam(0, 1.0, -0.8);
    systemRefs.environment?.spawnScorePopup(0, 1.3, -0.5, points);
    systemRefs.environment?.customerReact(true);

    // Update high score
    if (this.state.score > this.state.highScore) {
      this.state.highScore = this.state.score;
      try {
        localStorage.setItem('neon-sushi-highscore', String(this.state.highScore));
      } catch (_e) { /* ignore */ }
    }

    systemRefs.ui?.updateHUD();
    this.nextOrder();
  }

  private failOrder() {
    this.state.ordersFailed++;
    this.state.lives--;
    this.state.combo = 1;
    this.state.streak = 0;

    systemRefs.audio?.playFail();
    systemRefs.environment?.clearAssembly();

    if (this.state.lives <= 0) {
      this.gameOver();
    } else {
      this.nextOrder();
    }
  }

  private waveComplete() {
    this.state.phase = 'wave-complete';
    systemRefs.audio?.playWaveComplete();
    systemRefs.ui?.showWaveComplete();

    // Bonus for perfect wave
    if (this.state.ordersFailed === 0) {
      const bonus = 100 * this.state.wave;
      this.state.score += bonus;
    }

    // Next wave after delay
    setTimeout(() => {
      if (this.state.phase === 'wave-complete') {
        this.state.wave++;
        this.state.phase = 'playing';
        this.startWave();
        systemRefs.ui?.updateHUD();
      }
    }, 2500);
  }

  private gameOver() {
    this.state.phase = 'game-over';
    systemRefs.audio?.stopMusic();
    systemRefs.ui?.showGameOver();
  }

  pause() {
    if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
    }
  }

  resume() {
    if (this.state.phase === 'paused') {
      this.state.phase = 'playing';
    }
  }

  update(delta: number) {
    if (this.state.phase !== 'playing') return;

    // Update order timer
    if (this.state.currentOrder) {
      this.state.currentOrder.timeRemaining -= delta;
      if (this.state.currentOrder.timeRemaining <= 0) {
        this.failOrder();
      }
      systemRefs.ui?.updateHUD();
    }
  }
}

// ============================================================
// UI System
// ============================================================

export class UISystem extends createSystem({}) {
  private menuPanel: UIKitMLAsset | null = null;
  private hudPanel: UIKitMLAsset | null = null;
  private orderPanel: UIKitMLAsset | null = null;
  private gameOverPanel: UIKitMLAsset | null = null;
  private settingsPanel: UIKitMLAsset | null = null;
  private recipePanel: UIKitMLAsset | null = null;
  private wavePanel: UIKitMLAsset | null = null;
  private initialized = false;

  init() {
    systemRefs.ui = this;

    // Defer panel setup
    setTimeout(() => this.setupPanels(), 500);
  }

  private setupPanels() {
    this.menuPanel = this.world.getSceneObject<UIKitMLAsset>('menu-panel') ?? null;
    this.hudPanel = this.world.getSceneObject<UIKitMLAsset>('hud-panel') ?? null;
    this.orderPanel = this.world.getSceneObject<UIKitMLAsset>('order-panel') ?? null;
    this.gameOverPanel = this.world.getSceneObject<UIKitMLAsset>('game-over-panel') ?? null;
    this.settingsPanel = this.world.getSceneObject<UIKitMLAsset>('settings-panel') ?? null;
    this.recipePanel = this.world.getSceneObject<UIKitMLAsset>('recipe-panel') ?? null;
    this.wavePanel = this.world.getSceneObject<UIKitMLAsset>('wave-panel') ?? null;

    this.wireMenuPanel();
    this.wireHudPanel();
    this.wireGameOverPanel();
    this.wireSettingsPanel();
    this.wireRecipePanel();

    this.showOnly('menu');
    this.initialized = true;
  }

  private wireMenuPanel() {
    if (!this.menuPanel) return;
    this.menuPanel.getElementById('btn-play')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      systemRefs.game?.startGame();
      this.showOnly('playing');
    });
    this.menuPanel.getElementById('btn-settings')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      this.showOnly('settings');
    });
    this.menuPanel.getElementById('btn-recipe')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      this.showOnly('recipe');
    });
  }

  private wireHudPanel() {
    if (!this.hudPanel) return;
    this.hudPanel.getElementById('btn-pause')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      const game = systemRefs.game;
      if (game) {
        if (game.state.phase === 'playing') {
          game.pause();
          this.showPause();
        } else if (game.state.phase === 'paused') {
          game.resume();
          this.showOnly('playing');
        }
      }
    });

    // Wire wave/pause panel resume/quit buttons
    this.wavePanel?.getElementById('btn-resume')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      systemRefs.game?.resume();
      this.showOnly('playing');
    });
    this.wavePanel?.getElementById('btn-quit-pause')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      if (systemRefs.game) {
        systemRefs.game.state.phase = 'menu';
      }
      this.showOnly('menu');
    });
  }

  private wireGameOverPanel() {
    if (!this.gameOverPanel) return;
    this.gameOverPanel.getElementById('btn-retry')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      systemRefs.game?.startGame();
      this.showOnly('playing');
    });
    this.gameOverPanel.getElementById('btn-menu')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      this.showOnly('menu');
      if (systemRefs.game) {
        systemRefs.game.state.phase = 'menu';
      }
    });
  }

  private wireSettingsPanel() {
    if (!this.settingsPanel) return;
    const game = systemRefs.game;

    this.settingsPanel.getElementById('btn-difficulty')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      if (game) {
        game.state.difficulty = (game.state.difficulty + 1) % 3;
        const labels = ['EASY', 'NORMAL', 'HARD'];
        this.settingsPanel?.getElementById('difficulty-text')?.setProperties({
          text: labels[game.state.difficulty],
        });
      }
    });

    this.settingsPanel.getElementById('btn-sfx')?.addEventListener('click', () => {
      if (game) {
        game.state.sfxEnabled = !game.state.sfxEnabled;
        systemRefs.audio?.setSfxEnabled(game.state.sfxEnabled);
        this.settingsPanel?.getElementById('sfx-text')?.setProperties({
          text: game.state.sfxEnabled ? 'ON' : 'OFF',
        });
      }
      systemRefs.audio?.playClick();
    });

    this.settingsPanel.getElementById('btn-music')?.addEventListener('click', () => {
      if (game) {
        game.state.musicEnabled = !game.state.musicEnabled;
        systemRefs.audio?.setMusicEnabled(game.state.musicEnabled);
        this.settingsPanel?.getElementById('music-text')?.setProperties({
          text: game.state.musicEnabled ? 'ON' : 'OFF',
        });
      }
      systemRefs.audio?.playClick();
    });

    this.settingsPanel.getElementById('btn-back')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      this.showOnly('menu');
    });
  }

  private wireRecipePanel() {
    if (!this.recipePanel) return;
    this.recipePanel.getElementById('btn-back-recipe')?.addEventListener('click', () => {
      systemRefs.audio?.playClick();
      this.showOnly('menu');
    });
  }

  showOnly(view: string) {
    if (this.menuPanel) this.menuPanel.visible = (view === 'menu');
    if (this.hudPanel) this.hudPanel.visible = (view === 'playing' || view === 'wave-complete');
    if (this.orderPanel) this.orderPanel.visible = (view === 'playing');
    if (this.gameOverPanel) this.gameOverPanel.visible = (view === 'game-over');
    if (this.settingsPanel) this.settingsPanel.visible = (view === 'settings');
    if (this.recipePanel) this.recipePanel.visible = (view === 'recipe');
    if (this.wavePanel) this.wavePanel.visible = (view === 'wave-complete' || view === 'paused');
  }

  updateHUD() {
    const game = systemRefs.game;
    if (!game || !this.hudPanel) return;

    this.hudPanel.getElementById('score')?.setProperties({
      text: String(game.state.score),
    });
    this.hudPanel.getElementById('wave')?.setProperties({
      text: String(game.state.wave),
    });
    this.hudPanel.getElementById('combo')?.setProperties({
      text: `x${game.state.combo}`,
    });
    this.hudPanel.getElementById('lives')?.setProperties({
      text: String(game.state.lives),
    });

    const order = game.state.currentOrder;
    if (order) {
      const t = Math.max(0, Math.ceil(order.timeRemaining));
      this.hudPanel.getElementById('timer')?.setProperties({
        text: String(t),
        color: t <= 5 ? '#ff2222' : t <= 10 ? '#ffaa00' : '#ff4433',
      });
    }
  }

  updateOrderPanel() {
    const game = systemRefs.game;
    if (!game || !this.orderPanel) return;

    const order = game.state.currentOrder;
    if (!order) return;

    // Set order name with fish type
    const fishName = order.recipe.steps.includes('fish')
      ? order.fish.charAt(0).toUpperCase() + order.fish.slice(1)
      : '';
    this.orderPanel.getElementById('order-name')?.setProperties({
      text: `${fishName} ${order.recipe.displayName}`.trim(),
    });

    // Rush/golden labels
    this.orderPanel.getElementById('rush-label')?.setProperties({
      text: order.isRush ? 'RUSH ORDER!' : ' ',
      color: order.isRush ? '#ff44ff' : '#ff44ff',
    });
    this.orderPanel.getElementById('bonus-label')?.setProperties({
      text: order.isGolden ? 'GOLDEN - 2.5x BONUS' : ' ',
    });

    // Update steps
    for (let i = 0; i < 4; i++) {
      const stepEl = this.orderPanel.getElementById(`step-${i + 1}-text`);
      const checkEl = this.orderPanel.getElementById(`step-${i + 1}-check`);
      const rowEl = this.orderPanel.getElementById(`step-${i + 1}`);

      if (i < order.recipe.steps.length) {
        const stepName = order.recipe.steps[i];
        let displayName = stepName.charAt(0).toUpperCase() + stepName.slice(1);
        if (stepName === 'fish') displayName = `Add ${fishName}`;
        else if (stepName === 'topping') displayName = `Add ${order.topping}`;
        else displayName = `Add ${displayName}`;

        stepEl?.setProperties({ text: displayName });

        if (i < game.state.currentStepIndex) {
          checkEl?.setProperties({ text: 'DONE' });
          rowEl?.setProperties({ backgroundColor: 'rgba(60, 200, 100, 0.15)' });
        } else if (i === game.state.currentStepIndex) {
          checkEl?.setProperties({ text: '>>>' });
          rowEl?.setProperties({ backgroundColor: 'rgba(255, 100, 60, 0.2)' });
        } else {
          checkEl?.setProperties({ text: ' ' });
          rowEl?.setProperties({ backgroundColor: 'rgba(0, 0, 0, 0)' });
        }
      } else {
        stepEl?.setProperties({ text: ' ' });
        checkEl?.setProperties({ text: ' ' });
        rowEl?.setProperties({ backgroundColor: 'rgba(0, 0, 0, 0)' });
      }
    }

    // Queue preview
    const queue = game.state.orderQueue;
    for (let i = 0; i < 2; i++) {
      const queueEl = this.orderPanel.getElementById(`queue-${i + 1}`);
      if (i < queue.length) {
        const q = queue[i];
        const qFish = q.fish.charAt(0).toUpperCase() + q.fish.slice(1);
        let label = `${qFish} ${q.recipe.displayName}`;
        if (q.isRush) label += ' [RUSH]';
        if (q.isGolden) label += ' [GOLD]';
        queueEl?.setProperties({ text: label });
      } else {
        queueEl?.setProperties({ text: ' ' });
      }
    }
  }

  showWaveComplete() {
    const game = systemRefs.game;
    if (!game) return;

    this.showOnly('wave-complete');

    // Update wave panel
    this.wavePanel?.getElementById('wave-label')?.setProperties({ text: 'WAVE COMPLETE' });
    this.wavePanel?.getElementById('wave-num')?.setProperties({ text: String(game.state.wave) });
    this.wavePanel?.getElementById('clear-text')?.setProperties({ text: 'GREAT WORK!' });

    const bonus = game.state.ordersFailed === 0 ? `PERFECT WAVE! +${100 * game.state.wave}` : ' ';
    this.wavePanel?.getElementById('bonus-text')?.setProperties({ text: bonus });

    // Hide resume/quit buttons (they're for pause)
    this.wavePanel?.getElementById('btn-resume')?.setProperties({ display: 'none' });
    this.wavePanel?.getElementById('btn-quit-pause')?.setProperties({ display: 'none' });

    // Update HUD timer
    this.hudPanel?.getElementById('timer')?.setProperties({
      text: 'CLEAR!',
      color: '#44dd88',
    });
  }

  showPause() {
    this.showOnly('paused');
    this.wavePanel?.getElementById('wave-label')?.setProperties({ text: 'PAUSED' });
    this.wavePanel?.getElementById('wave-num')?.setProperties({ text: 'II' });
    this.wavePanel?.getElementById('clear-text')?.setProperties({ text: ' ' });
    this.wavePanel?.getElementById('bonus-text')?.setProperties({ text: ' ' });
    this.wavePanel?.getElementById('btn-resume')?.setProperties({ display: 'flex' });
    this.wavePanel?.getElementById('btn-quit-pause')?.setProperties({ display: 'flex' });
  }

  showGameOver() {
    const game = systemRefs.game;
    if (!game) return;

    this.showOnly('game-over');

    const accuracy = game.state.totalOrders > 0
      ? Math.round((game.state.sushiServed / game.state.totalOrders) * 100)
      : 0;

    // Lifetime mastery — persistent across games
    let lifetimeServed = 0;
    let lifetimeGames = 0;
    let bestWave = 0;
    try {
      lifetimeServed = parseInt(localStorage.getItem('neon-sushi-lifetime-served') ?? '0', 10);
      lifetimeGames = parseInt(localStorage.getItem('neon-sushi-lifetime-games') ?? '0', 10);
      bestWave = parseInt(localStorage.getItem('neon-sushi-best-wave') ?? '0', 10);
    } catch (_e) { /* ignore */ }

    lifetimeServed += game.state.sushiServed;
    lifetimeGames += 1;
    bestWave = Math.max(bestWave, game.state.wave - 1);

    try {
      localStorage.setItem('neon-sushi-lifetime-served', String(lifetimeServed));
      localStorage.setItem('neon-sushi-lifetime-games', String(lifetimeGames));
      localStorage.setItem('neon-sushi-best-wave', String(bestWave));
    } catch (_e) { /* ignore */ }

    // Rank based on lifetime served
    let rank = 'Apprentice';
    if (lifetimeServed >= 500) rank = 'Sushi Legend';
    else if (lifetimeServed >= 300) rank = 'Master Chef';
    else if (lifetimeServed >= 150) rank = 'Head Chef';
    else if (lifetimeServed >= 75) rank = 'Sous Chef';
    else if (lifetimeServed >= 30) rank = 'Line Cook';
    else if (lifetimeServed >= 10) rank = 'Prep Cook';

    this.gameOverPanel?.getElementById('final-score')?.setProperties({
      text: String(game.state.score),
    });
    this.gameOverPanel?.getElementById('high-score')?.setProperties({
      text: `BEST: ${game.state.highScore}`,
    });
    this.gameOverPanel?.getElementById('rank')?.setProperties({
      text: rank,
    });
    this.gameOverPanel?.getElementById('served')?.setProperties({
      text: String(game.state.sushiServed),
    });
    this.gameOverPanel?.getElementById('failed')?.setProperties({
      text: String(game.state.ordersFailed),
    });
    this.gameOverPanel?.getElementById('best-combo')?.setProperties({
      text: `x${game.state.bestCombo}`,
    });
    this.gameOverPanel?.getElementById('waves-cleared')?.setProperties({
      text: String(game.state.wave - 1),
    });
    this.gameOverPanel?.getElementById('accuracy')?.setProperties({
      text: `${accuracy}%`,
    });
    this.gameOverPanel?.getElementById('best-streak')?.setProperties({
      text: String(game.state.bestStreak),
    });
  }

  update() {
    // Periodic HUD updates handled by game system calling updateHUD
  }
}

// ============================================================
// Station Interaction System
// ============================================================

export class StationInteractionSystem extends createSystem({
  stations: { required: [RayInteractable] },
}) {
  private stationEntities: WeakMap<object, string> = new WeakMap();
  private cooldown = 0;

  init() {
    // Map entities to station types by position
    this.queries.stations.subscribe('qualify', (entity) => {
      const obj = entity.object3D;
      if (obj) {
        const x = obj.position.x;
        // Match by x position to station type
        let stationType = '';
        if (Math.abs(x - (-1.8)) < 0.3) stationType = 'rice';
        else if (Math.abs(x - (-0.9)) < 0.3) stationType = 'nori';
        else if (Math.abs(x - 0.0) < 0.3) stationType = 'fish';
        else if (Math.abs(x - 0.9) < 0.3) stationType = 'topping';
        else if (Math.abs(x - 1.8) < 0.3) stationType = 'serve';
        if (stationType && obj) {
          this.stationEntities.set(obj, stationType);
        }
      }
    });
  }

  update(delta: number) {
    this.cooldown = Math.max(0, this.cooldown - delta);

    for (const entity of this.queries.stations.entities) {
      if (entity.hasComponent(Pressed) && this.cooldown <= 0) {
        const obj = entity.object3D;
        if (obj) {
          const stationType = this.stationEntities.get(obj);
          if (stationType) {
            systemRefs.game?.handleStationClick(stationType);
            this.cooldown = 0.25;
          }
        }
      }
    }

    // Also handle keyboard input for browser mode
    const kb = this.world.input.keyboard;
    if (kb && this.cooldown <= 0) {
      if (kb.getKeyDown('1') || kb.getKeyDown('Digit1')) {
        systemRefs.game?.handleStationClick('rice');
        this.cooldown = 0.25;
      } else if (kb.getKeyDown('2') || kb.getKeyDown('Digit2')) {
        systemRefs.game?.handleStationClick('nori');
        this.cooldown = 0.25;
      } else if (kb.getKeyDown('3') || kb.getKeyDown('Digit3')) {
        systemRefs.game?.handleStationClick('fish');
        this.cooldown = 0.25;
      } else if (kb.getKeyDown('4') || kb.getKeyDown('Digit4')) {
        systemRefs.game?.handleStationClick('topping');
        this.cooldown = 0.25;
      } else if (kb.getKeyDown('5') || kb.getKeyDown('Digit5') || kb.getKeyDown(' ') || kb.getKeyDown('Space')) {
        systemRefs.game?.handleStationClick('serve');
        this.cooldown = 0.25;
      }
    }
  }
}
