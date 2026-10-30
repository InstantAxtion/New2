import type { BodyShape } from './carbody';

export type Finish = 'metallic' | 'solid' | 'matte' | 'pearl';
export type RimStyle = 'five' | 'multi' | 'turbine' | 'steel' | 'beadlock';
export type Trim = 'black' | 'wood' | 'carbon' | 'alu';
export type CabinStyle = 'sport' | 'comfort' | 'luxury' | 'classic' | 'ev' | 'utility' | 'van' | 'bike';
export type Engine = 'v8' | 'v12' | 'flat6' | 'i4' | 'i6' | 'v6' | 'diesel' | 'ev' | 'flat4' | 'twin';
export type Lights = 'slim' | 'round' | 'quad' | 'square' | 'bar';
export type Feature =
  | 'lip' | 'wing' | 'ducktail' | 'scoop' | 'rails' | 'rack' | 'spare' | 'bed' | 'bullbar' | 'lightbar' | 'snorkel'
  | 'fogs' | 'diffuser' | 'splitter' | 'skirts' | 'exhaust2' | 'exhaust4' | 'exhaustC' | 'antenna' | 'chrome' | 'fins'
  | 'nogrille' | 'softtop' | 'intakes' | 'mudflaps' | 'scissor' | 'poptop' | 'rooftent';

/** How a car drives and leans. */
export interface Handling {
  /** Body roll per m/s² of cornering (rad). */
  roll: number;
  /** Nose dive / squat per m/s² (rad). */
  dive: number;
  /** How fast the front wheels turn (share of lock per second). */
  steer: number;
  /** Suspension: how quickly the body settles (higher = stiffer). */
  spring: number;
}

export interface CarSpec extends BodyShape {
  id: string;
  name: string;
  blurb: string;
  /** Top speed, km/h. */
  top: number;
  /** Acceleration, m/s². */
  accel: number;
  /** Cornering grip, m/s². */
  grip: number;
  doors: 2 | 4;
  lights: Lights;
  cabin: CabinStyle;
  engine: Engine;
  handling: Handling;
  features: Feature[];
  defaultColor: number;
  rim: RimStyle;
  finish: Finish;
  /** A motorbike rather than a car. */
  bike?: boolean;
}

/** The player's choices for one car. */
export interface Custom {
  color: number;
  finish: Finish;
  /** Second colour: roof (two-tone) and stripes. */
  color2: number;
  twoTone: boolean;
  stripes: boolean;
  rim: RimStyle;
  rimColor: number;
  /** Ride height change, metres (-0.06 lowered … +0.08 raised). */
  ride: number;
  leather: number;
  trim: Trim;
  /** Ambient lighting colour at night (0 = off). */
  ambient: number;
  /** Number plate text ('' = the car's own made-up registration). */
  plate: string;
  /** Decal on the doors. */
  decal: 'none' | 'number' | 'flames' | 'stripe' | 'stars' | 'endless';
}

const H = (roll: number, dive: number, steer: number, spring: number): Handling => ({ roll, dive, steer, spring });

export const CARS: CarSpec[] = [
  {
    id: 'gt', name: 'Sprint GT', blurb: 'Rear-engined sports coupé', top: 270, accel: 8, grip: 10,
    length: 4.5, width: 1.95, wheel: 0.34, axles: [1.42, -1.35], defaultColor: 0xb3121b,
    sill: 0.2, belt: 0.8, nose: 0.5, tail: 0.72, deck: 0.86, roof: 1.24, A: 0.92, B: -0.08, C: -0.82, D: -1.72, tumble: 0.74,
    doors: 2, lights: 'slim', cabin: 'sport', engine: 'flat6', handling: H(0.005, 0.004, 4.2, 9), rim: 'five', finish: 'metallic',
    features: ['ducktail', 'diffuser', 'splitter', 'skirts', 'exhaust2', 'intakes', 'nogrille'],
  },
  {
    id: 'hatch', name: 'City Hatch', blurb: 'Small, nimble, happy', top: 185, accel: 4.8, grip: 8,
    length: 3.95, width: 1.78, wheel: 0.32, axles: [1.27, -1.25], defaultColor: 0x2a6fb5,
    sill: 0.24, belt: 0.9, nose: 0.62, tail: 0.95, deck: 0.98, roof: 1.47, A: 0.98, B: 0.12, C: -1.5, D: -1.9, tumble: 0.8,
    doors: 4, lights: 'slim', cabin: 'comfort', engine: 'i4', handling: H(0.01, 0.007, 3.8, 6), rim: 'multi', finish: 'metallic',
    features: ['lip', 'exhaust2', 'fogs'],
  },
  {
    id: 'suv', name: 'Trail SUV', blurb: 'Tall, tough, roof rails', top: 200, accel: 5.2, grip: 7.5,
    length: 4.75, width: 2.0, wheel: 0.41, axles: [1.47, -1.45], defaultColor: 0x3d4a3a,
    sill: 0.42, belt: 1.12, nose: 0.92, tail: 1.08, deck: 1.12, roof: 1.78, A: 1.22, B: 0.5, C: -2.1, D: -2.33, tumble: 0.84,
    doors: 4, lights: 'square', cabin: 'utility', engine: 'v6', handling: H(0.014, 0.01, 3, 4.5), rim: 'multi', finish: 'metallic',
    features: ['rails', 'spare', 'fogs', 'exhaust2', 'mudflaps'],
  },
  {
    id: 'pickup', name: 'Ranch Pickup', blurb: 'Big bed, big V8', top: 180, accel: 4.8, grip: 7,
    length: 5.3, width: 2.02, wheel: 0.42, axles: [1.75, -1.68], defaultColor: 0xd9d9d6,
    sill: 0.46, belt: 1.15, nose: 1.0, tail: 1.15, deck: 1.15, roof: 1.88, A: 1.35, B: 0.7, C: -0.42, D: -0.55, bed: true, tumble: 0.84,
    doors: 4, lights: 'square', cabin: 'utility', engine: 'v8', handling: H(0.013, 0.01, 2.8, 4.5), rim: 'multi', finish: 'solid',
    features: ['bed', 'fogs', 'exhaust2', 'mudflaps', 'chrome'],
  },
  {
    id: 'roadster', name: 'Breeze Roadster', blurb: 'Top down, wind in your hair', top: 225, accel: 6.8, grip: 9.5,
    length: 4.15, width: 1.82, wheel: 0.33, axles: [1.3, -1.25], defaultColor: 0xd9a21b,
    sill: 0.2, belt: 0.78, nose: 0.5, tail: 0.74, deck: 0.82, roof: 1.2, A: 0.55, B: 0.3, C: 0, D: 0, open: true,
    doors: 2, lights: 'slim', cabin: 'sport', engine: 'i6', handling: H(0.006, 0.005, 4.2, 8), rim: 'five', finish: 'metallic',
    features: ['exhaust2', 'skirts', 'softtop'],
  },
  {
    id: 'van', name: 'Weekender Van', blurb: 'Slow, roomy, perfect for trips', top: 150, accel: 3.4, grip: 6,
    length: 4.9, width: 1.98, wheel: 0.36, axles: [1.62, -1.6], defaultColor: 0x3f8f86,
    sill: 0.34, belt: 1.12, nose: 0.98, tail: 1.9, deck: 1.95, roof: 2.02, A: 2.05, B: 1.7, C: -2.35, D: -2.44, tumble: 0.9,
    doors: 2, lights: 'round', cabin: 'van', engine: 'flat4', handling: H(0.016, 0.012, 2.6, 4), rim: 'steel', finish: 'solid',
    features: ['chrome', 'mudflaps'],
  },
  {
    id: 'muscle', name: 'Thunder Muscle', blurb: 'Loud, proud, rear spoiler', top: 250, accel: 7.4, grip: 7.8,
    length: 4.85, width: 1.98, wheel: 0.36, axles: [1.5, -1.45], defaultColor: 0x1b2233,
    sill: 0.24, belt: 0.9, nose: 0.82, tail: 0.88, deck: 0.94, roof: 1.3, A: 0.82, B: -0.12, C: -0.95, D: -1.62, tumble: 0.76,
    doors: 2, lights: 'square', cabin: 'sport', engine: 'v8', handling: H(0.009, 0.009, 3.4, 6), rim: 'five', finish: 'metallic',
    features: ['scoop', 'wing', 'exhaust2', 'chrome'],
  },
  {
    id: 'bubble', name: 'Retro Bubble', blurb: 'Round, retro, unhurried', top: 140, accel: 3, grip: 6.5,
    length: 4.05, width: 1.72, wheel: 0.33, axles: [1.2, -1.2], defaultColor: 0x8fc3d6,
    sill: 0.28, belt: 0.82, nose: 0.5, tail: 0.55, deck: 0.62, roof: 1.48, A: 0.92, B: 0.42, C: -0.62, D: -1.85, tumble: 0.72,
    doors: 2, lights: 'round', cabin: 'classic', engine: 'flat4', handling: H(0.013, 0.01, 3, 4.5), rim: 'steel', finish: 'solid',
    features: ['chrome', 'antenna'],
  },
  {
    id: 'classic', name: "Coastline '64", blurb: 'A long, low sixties cruiser', top: 190, accel: 4.6, grip: 6.8,
    length: 5.1, width: 1.95, wheel: 0.35, axles: [1.62, -1.52], defaultColor: 0x6fa8a0,
    sill: 0.24, belt: 0.86, nose: 0.66, tail: 0.84, deck: 0.92, roof: 1.36, A: 0.65, B: 0.05, C: -1.05, D: -1.55, tumble: 0.8,
    doors: 2, lights: 'quad', cabin: 'classic', engine: 'v8', handling: H(0.015, 0.012, 2.8, 3.8), rim: 'steel', finish: 'solid',
    features: ['chrome', 'fins', 'exhaust2', 'antenna'],
  },
  {
    id: 'ev', name: 'Volt Hatch', blurb: 'Electric: silent and instant', top: 200, accel: 7, grip: 8.8,
    length: 4.3, width: 1.88, wheel: 0.34, axles: [1.38, -1.4], defaultColor: 0xe9ebee,
    sill: 0.22, belt: 0.92, nose: 0.62, tail: 0.98, deck: 1.0, roof: 1.48, A: 1.12, B: 0.32, C: -1.45, D: -2.0, tumble: 0.8,
    doors: 4, lights: 'bar', cabin: 'ev', engine: 'ev', handling: H(0.007, 0.006, 4, 7), rim: 'turbine', finish: 'pearl',
    features: ['nogrille', 'diffuser'],
  },
  {
    id: 'offroad', name: 'Ridge Off-Roader', blurb: 'Boxy, lifted, goes anywhere', top: 165, accel: 4.2, grip: 6.5,
    length: 4.6, width: 2.0, wheel: 0.47, axles: [1.42, -1.42], defaultColor: 0x6b6a43,
    sill: 0.55, belt: 1.25, nose: 1.12, tail: 1.22, deck: 1.25, roof: 1.98, A: 1.3, B: 1.0, C: -2.12, D: -2.24, tumble: 0.95,
    doors: 4, lights: 'round', cabin: 'utility', engine: 'diesel', handling: H(0.02, 0.014, 2.6, 3.5), rim: 'beadlock', finish: 'matte',
    features: ['bullbar', 'lightbar', 'snorkel', 'rack', 'spare', 'fogs', 'mudflaps'],
  },
  {
    id: 'wagon', name: 'Tourer Estate', blurb: 'A fast, roomy sports wagon', top: 260, accel: 7.2, grip: 9,
    length: 4.95, width: 1.92, wheel: 0.35, axles: [1.52, -1.45], defaultColor: 0x48505c,
    sill: 0.22, belt: 0.9, nose: 0.6, tail: 0.98, deck: 1.0, roof: 1.42, A: 1.02, B: 0.18, C: -2.05, D: -2.4, tumble: 0.78,
    doors: 4, lights: 'slim', cabin: 'luxury', engine: 'i6', handling: H(0.007, 0.006, 3.8, 7.5), rim: 'multi', finish: 'metallic',
    features: ['rails', 'exhaust4', 'lip', 'diffuser', 'skirts'],
  },
  {
    id: 'super', name: 'Apex V12', blurb: 'Mid-engined supercar', top: 340, accel: 10, grip: 12,
    length: 4.65, width: 2.04, wheel: 0.35, axles: [1.42, -1.38], defaultColor: 0xe0701e,
    sill: 0.14, belt: 0.72, nose: 0.42, tail: 0.86, deck: 0.92, roof: 1.12, A: 0.72, B: -0.18, C: -0.85, D: -1.95, tumble: 0.7,
    doors: 2, lights: 'slim', cabin: 'sport', engine: 'v12', handling: H(0.003, 0.003, 4.8, 11), rim: 'turbine', finish: 'pearl',
    features: ['wing', 'diffuser', 'splitter', 'skirts', 'exhaustC', 'intakes', 'nogrille'],
  },
  {
    id: 'veloce', name: 'Strada Veloce', blurb: 'Low, wedge-shaped mid-engined V8', top: 320, accel: 9.4, grip: 11.5,
    length: 4.55, width: 2.0, wheel: 0.35, axles: [1.4, -1.35], defaultColor: 0xe6c21c,
    sill: 0.15, belt: 0.74, nose: 0.4, tail: 0.84, deck: 0.9, roof: 1.12, A: 0.8, B: -0.2, C: -0.95, D: -1.92, tumble: 0.68,
    doors: 2, lights: 'slim', cabin: 'sport', engine: 'v8', handling: H(0.003, 0.003, 4.7, 10.5), rim: 'five', finish: 'solid',
    features: ['lip', 'diffuser', 'skirts', 'exhaust4', 'intakes', 'nogrille', 'ducktail'],
  },
  {
    id: 'hyper', name: 'Halo Hyper', blurb: 'Hypercar with scissor doors', top: 380, accel: 11, grip: 13,
    length: 4.72, width: 2.06, wheel: 0.36, axles: [1.45, -1.4], defaultColor: 0x1d3a8a,
    sill: 0.12, belt: 0.68, nose: 0.38, tail: 0.8, deck: 0.86, roof: 1.08, A: 0.62, B: -0.26, C: -0.9, D: -2.0, tumble: 0.66,
    doors: 2, lights: 'slim', cabin: 'sport', engine: 'v12', handling: H(0.0025, 0.0025, 5, 12), rim: 'turbine', finish: 'pearl',
    features: ['wing', 'diffuser', 'splitter', 'skirts', 'exhaustC', 'intakes', 'nogrille', 'scissor'],
  },
  {
    id: 'starliner', name: "Starliner '57", blurb: 'A big fifties cruiser: chrome, fins, two-tone', top: 175, accel: 3.8, grip: 6,
    length: 5.5, width: 2.02, wheel: 0.37, axles: [1.75, -1.62], defaultColor: 0xd85f7a,
    sill: 0.26, belt: 0.92, nose: 0.74, tail: 0.86, deck: 0.95, roof: 1.44, A: 0.75, B: 0.15, C: -1.0, D: -1.6, tumble: 0.82,
    doors: 2, lights: 'round', cabin: 'classic', engine: 'v8', handling: H(0.018, 0.013, 2.6, 3.4), rim: 'steel', finish: 'solid',
    features: ['chrome', 'fins', 'exhaust2', 'antenna'],
  },
  {
    id: 'spider', name: "Riviera Spider '62", blurb: 'A little classic convertible', top: 180, accel: 4.6, grip: 7.6,
    length: 3.95, width: 1.62, wheel: 0.31, axles: [1.18, -1.12], defaultColor: 0x9a1c26,
    sill: 0.22, belt: 0.74, nose: 0.52, tail: 0.66, deck: 0.72, roof: 1.12, A: 0.45, B: 0.2, C: 0, D: 0, open: true,
    doors: 2, lights: 'round', cabin: 'classic', engine: 'i4', handling: H(0.012, 0.009, 3.6, 5), rim: 'steel', finish: 'solid',
    features: ['chrome', 'softtop', 'exhaust2'],
  },
  {
    id: 'wanderer', name: 'Wanderer Camper', blurb: 'Retro camper; the roof pops up when you stop', top: 130, accel: 2.8, grip: 5.5,
    length: 4.6, width: 1.9, wheel: 0.35, axles: [1.2, -1.25], defaultColor: 0xe3a33a,
    sill: 0.36, belt: 1.1, nose: 0.95, tail: 1.85, deck: 1.9, roof: 1.98, A: 2.0, B: 1.75, C: -2.2, D: -2.28, tumble: 0.9,
    doors: 2, lights: 'round', cabin: 'van', engine: 'flat4', handling: H(0.018, 0.013, 2.4, 3.6), rim: 'steel', finish: 'solid',
    features: ['chrome', 'poptop', 'mudflaps'],
  },
  {
    id: 'nomad', name: 'Nomad Overlander', blurb: 'Expedition 4x4 with a roof tent', top: 160, accel: 4, grip: 6.4,
    length: 4.9, width: 2.02, wheel: 0.48, axles: [1.55, -1.45], defaultColor: 0xc4ad85,
    sill: 0.58, belt: 1.28, nose: 1.15, tail: 1.25, deck: 1.28, roof: 2.0, A: 1.32, B: 1.02, C: -2.3, D: -2.42, tumble: 0.94,
    doors: 4, lights: 'round', cabin: 'utility', engine: 'diesel', handling: H(0.02, 0.014, 2.5, 3.4), rim: 'beadlock', finish: 'matte',
    features: ['bullbar', 'rack', 'rooftent', 'snorkel', 'spare', 'fogs', 'mudflaps', 'lightbar'],
  },
  {
    id: 'bike', name: 'Horizon Tourer', blurb: 'A motorbike: lean into the bends', top: 230, accel: 8.5, grip: 9,
    length: 2.2, width: 0.8, wheel: 0.33, axles: [0.74, -0.72], defaultColor: 0x1f4fa8,
    sill: 0.3, belt: 0.9, nose: 0.8, tail: 0.8, deck: 0.9, roof: 1.2, A: 0.3, B: 0, C: -0.3, D: -0.5, open: true,
    doors: 2, lights: 'round', cabin: 'bike', engine: 'twin', handling: H(-0.055, 0.006, 5.5, 8), rim: 'five', finish: 'metallic',
    features: [], bike: true,
  },
];

export const COLORS = [0xb3121b, 0xd9a21b, 0xf2f1ec, 0x1b2233, 0x2a6fb5, 0x3d4a3a, 0x3f8f86, 0x8fc3d6, 0xc85a8f, 0x6a4bb0, 0x1e1f22, 0xa9aeb5, 0xe0701e, 0x6b6a43, 0x48505c, 0x6fa8a0];
export const LEATHERS = [0x1c1c1e, 0x6b3b22, 0x8c1c1c, 0xd9cfbf, 0x2a3550, 0x5b5f66];
export const AMBIENTS = [0, 0x5ab4ff, 0xff4fa3, 0xffb547, 0x7cff9a, 0xb07cff];
export const RIM_COLORS = [0xc9ccd1, 0x1d1e21, 0xa7834d, 0xe6e7ea];

export function defaultCustom(spec: CarSpec): Custom {
  const classic = spec.cabin === 'classic' || spec.cabin === 'van';
  return {
    color: spec.defaultColor,
    finish: spec.finish,
    color2: spec.id === 'van' ? 0xefefea : spec.id === 'muscle' || spec.id === 'starliner' || spec.id === 'wanderer' ? 0xf2f1ec : 0x1e1f22,
    twoTone: spec.id === 'van' || spec.id === 'classic' || spec.id === 'starliner' || spec.id === 'wanderer',
    stripes: spec.id === 'muscle',
    rim: spec.rim,
    rimColor: spec.rim === 'beadlock' ? 0x1d1e21 : spec.rim === 'steel' ? 0xe6e7ea : 0xc9ccd1,
    ride: 0,
    leather: classic ? 0x6b3b22 : spec.cabin === 'luxury' ? 0xd9cfbf : 0x1c1c1e,
    trim: spec.cabin === 'luxury' || spec.cabin === 'classic' ? 'wood' : spec.cabin === 'sport' ? 'carbon' : spec.cabin === 'ev' ? 'alu' : 'black',
    ambient: spec.cabin === 'ev' || spec.cabin === 'luxury' ? 0x5ab4ff : 0,
    plate: '',
    decal: 'none',
  };
}
