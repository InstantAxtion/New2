export type TechCat = 'land' | 'air' | 'naval' | 'missile' | 'cyber' | 'economy' | 'space';

export interface TechDef {
  id: string;
  name: string;
  cat: TechCat;
  year: number; // historical year it became available
  cost: number; // research points
  req: string[];
  fx: Record<string, number>;
  desc: string;
}

const T = (id: string, name: string, cat: TechCat, year: number, cost: number, req: string[], fx: Record<string, number>, desc: string): TechDef =>
  ({ id, name, cat, year, cost, req, fx, desc });

export const TECHS: TechDef[] = [
  // ---- land
  T('tanks', 'Tanks', 'land', 1916, 400, [], {}, 'Unlocks Armored Divisions.'),
  T('motorized', 'Motorized Infantry', 'land', 1935, 600, ['tanks'], { 'speed.land': 0.2 }, '+20% land movement speed.'),
  T('combined_arms', 'Combined Arms Doctrine', 'land', 1942, 800, ['motorized'], { 'atk.land': 0.1 }, '+10% land attack.'),
  T('modern_armor', 'Modern Battle Tanks', 'land', 1980, 1400, ['combined_arms'], { 'atk.armor': 0.25, 'def.armor': 0.25 }, '+25% armor attack and defense.'),
  T('night_vision', 'Night Vision', 'land', 1985, 1200, ['combined_arms'], { 'atk.land': 0.1, 'def.land': 0.05 }, '+10% land attack, +5% defense.'),
  T('precision_artillery', 'Precision Artillery', 'land', 2005, 1600, ['night_vision'], { 'atk.artillery': 0.3 }, '+30% artillery attack.'),
  T('netcentric', 'Network-Centric Warfare', 'land', 2010, 2000, ['precision_artillery', 'internet'], { 'org': 0.15, 'atk.land': 0.05 }, '+15% organisation recovery, +5% attack.'),
  T('exoskeletons', 'Powered Exoskeletons', 'land', 2032, 3200, ['netcentric'], { 'atk.infantry': 0.2, 'def.infantry': 0.2 }, '+20% infantry attack and defense.'),
  T('railguns', 'Railguns', 'land', 2035, 3600, ['modern_armor', 'fusion_research'], { 'atk.armor': 0.25, 'naval': 0.2 }, '+25% armor attack, +20% naval attack.'),
  T('robotic_units', 'Robotic Combat Units', 'land', 2040, 4500, ['exoskeletons', 'ai_drones'], { 'manpowerCost': -0.4, 'atk.land': 0.1 }, '-40% manpower cost, +10% land attack.'),
  T('logistics', 'Modern Logistics', 'land', 1950, 900, ['motorized'], { supply: 0.2 }, '+20% supply range and throughput.'),

  // ---- air
  T('aviation', 'Military Aviation', 'air', 1912, 300, [], {}, 'Unlocks Fighter and Airlift wings.'),
  T('strategic_bombing', 'Strategic Bombers', 'air', 1935, 700, ['aviation'], {}, 'Unlocks Bomber wings.'),
  T('radar', 'Radar', 'air', 1938, 700, ['aviation'], { aa: 0.2 }, 'Unlocks Air Defense batteries, +20% anti-air.'),
  T('jets', 'Jet Engines', 'air', 1945, 1000, ['strategic_bombing'], { air: 0.3 }, '+30% air power.'),
  T('helicopters', 'Attack Helicopters', 'air', 1960, 1000, ['jets'], { cas: 0.25 }, '+25% close air support.'),
  T('stealth', 'Stealth Aircraft', 'air', 1985, 2000, ['jets'], { stealth: 0.5 }, 'Bombers take 50% fewer losses.'),
  T('uav', 'UAV Drones', 'air', 2000, 1500, ['jets', 'computers'], {}, 'Unlocks Drone Squadrons.'),
  T('ai_drones', 'AI Drone Swarms', 'air', 2030, 3000, ['uav', 'ai_research'], { 'atk.drone': 0.6 }, '+60% drone strike power.'),
  T('gen6', '6th-Generation Fighters', 'air', 2035, 3800, ['stealth', 'ai_drones'], { air: 0.4 }, '+40% air power.'),

  // ---- naval
  T('dreadnought', 'Dreadnoughts', 'naval', 1906, 400, [], {}, 'Unlocks Battleships.'),
  T('submarines', 'Submarines', 'naval', 1905, 400, [], {}, 'Unlocks Submarine flotillas.'),
  T('sonar', 'Sonar', 'naval', 1918, 600, ['submarines'], { asw: 0.4 }, '+40% anti-submarine warfare.'),
  T('carriers', 'Aircraft Carriers', 'naval', 1925, 900, ['aviation', 'dreadnought'], {}, 'Unlocks Carrier Groups.'),
  T('nuclear_subs', 'Nuclear Submarines', 'naval', 1955, 1500, ['sonar', 'fission'], { 'atk.submarine': 0.4, slbm: 1 }, '+40% submarine attack. Subs can launch nuclear missiles.'),
  T('supercarriers', 'Supercarriers', 'naval', 1975, 2000, ['carriers', 'jets'], { 'atk.carrier': 0.4, 'def.carrier': 0.3 }, '+40% carrier attack, +30% defense.'),
  T('aegis', 'Aegis Combat System', 'naval', 1983, 1800, ['radar', 'computers'], { 'aa': 0.3, 'def.destroyer': 0.3 }, '+30% anti-air, destroyers +30% defense.'),

  // ---- missiles & nuclear
  T('rocketry', 'Rocketry', 'missile', 1944, 800, [], {}, 'Unlocks Missile Batteries.'),
  T('fission', 'Nuclear Fission', 'missile', 1945, 1500, ['rocketry'], { nukes: 1 }, 'Allows building nuclear warheads (requires uranium).'),
  T('icbm', 'ICBMs', 'missile', 1959, 1500, ['fission'], { icbm: 1 }, 'Nuclear strikes can reach anywhere on Earth.'),
  T('sam', 'Surface-to-Air Missiles', 'missile', 1955, 900, ['radar', 'rocketry'], { aa: 0.5 }, '+50% anti-air.'),
  T('cruise_missiles', 'Cruise Missiles', 'missile', 1980, 1400, ['rocketry', 'computers'], { missile: 0.3, 'range.missile': 0.5 }, '+30% missile damage, +50% range.'),
  T('hypersonic', 'Hypersonic Missiles', 'missile', 2022, 2600, ['cruise_missiles'], { bypass: 0.5, missile: 0.2 }, 'Missiles bypass 50% of air defenses.'),
  T('missile_shield', 'Missile Shield', 'missile', 2025, 3000, ['sam', 'satellites'], { intercept: 0.4 }, 'Intercept 40% of incoming missiles and nukes.'),
  T('laser_defense', 'Laser Point Defense', 'missile', 2035, 3800, ['missile_shield', 'fusion_research'], { intercept: 0.25, aa: 0.3 }, '+25% interception, +30% anti-air.'),

  // ---- cyber & intel
  T('signals_intel', 'Signals Intelligence', 'cyber', 1920, 500, [], { spy: 0.1 }, '+10% covert op success.'),
  T('satellites', 'Spy Satellites', 'cyber', 1960, 1500, ['spaceflight'], { satellite: 1 }, 'Reveals enemy units in nations you are at war with.'),
  T('internet', 'Internet', 'cyber', 1990, 1200, ['computers'], { research: 0.1 }, '+10% research speed.'),
  T('cyber_warfare', 'Cyber Warfare', 'cyber', 2010, 1800, ['internet'], { cyber: 1 }, 'Unlocks cyber attacks on power grids, banks and radar.'),
  T('cyber_defense', 'Cyber Defense', 'cyber', 2012, 1600, ['internet'], { cyberdef: 0.5 }, 'Enemy cyber attacks 50% less likely to succeed.'),
  T('ai_research', 'Artificial Intelligence', 'cyber', 2024, 2500, ['internet'], { research: 0.15, spy: 0.1 }, '+15% research, +10% covert success.'),
  T('quantum_crypto', 'Quantum Encryption', 'cyber', 2032, 3000, ['ai_research', 'cyber_defense'], { cyberdef: 0.4, counter: 0.3 }, 'Strong protection against espionage and cyber attacks.'),

  // ---- economy
  T('assembly_line', 'Assembly Line', 'economy', 1913, 400, [], { production: 0.1 }, '+10% military production.'),
  T('computers', 'Computers', 'economy', 1955, 1000, ['assembly_line'], { research: 0.1 }, '+10% research speed.'),
  T('green_revolution', 'Green Revolution', 'economy', 1965, 900, ['assembly_line'], { 'res.food': 0.3 }, '+30% food production.'),
  T('automation', 'Industrial Automation', 'economy', 1980, 1400, ['computers'], { production: 0.15, growth: 0.3 }, '+15% production, +0.3% GDP growth.'),
  T('fracking', 'Fracking', 'economy', 2008, 1400, ['automation'], { 'res.oil': 0.25, 'res.gas': 0.3 }, '+25% oil and +30% gas production.'),
  T('renewables', 'Renewable Energy', 'economy', 2010, 1600, ['automation'], { 'demand.oil': -0.2, 'demand.gas': -0.2 }, '-20% oil and gas demand.'),
  T('ai_economy', 'AI-Driven Economy', 'economy', 2030, 3200, ['ai_research'], { growth: 0.8, production: 0.1 }, '+0.8% GDP growth, +10% production.'),
  T('deep_mining', 'Deep-Sea Mining', 'economy', 2032, 2800, ['automation'], { 'res.rare': 0.5, 'res.steel': 0.2 }, '+50% rare earths, +20% steel.'),
  T('fusion_research', 'Fusion Research', 'economy', 2033, 3500, ['renewables'], { research: 0.05 }, 'Prerequisite for fusion power and railguns.'),
  T('fusion', 'Fusion Power', 'economy', 2045, 6000, ['fusion_research'], { 'demand.oil': -0.5, 'demand.gas': -0.5, growth: 1 }, '-50% oil and gas demand, +1% growth.'),

  // ---- space
  T('spaceflight', 'Spaceflight', 'space', 1957, 1200, ['rocketry'], { stability: 2 }, 'Opens the space race.'),
  T('moon_landing', 'Moon Landing', 'space', 1969, 2000, ['spaceflight'], { stability: 5 }, 'National prestige: +5 stability.'),
  T('space_station', 'Space Station', 'space', 1998, 2400, ['moon_landing', 'computers'], { research: 0.05 }, '+5% research.'),
  T('reusable_rockets', 'Reusable Rockets', 'space', 2018, 2800, ['space_station'], { growth: 0.2 }, 'Cheap orbit: +0.2% growth.'),
  T('space_weapons', 'Orbital Weapons', 'space', 2040, 5000, ['reusable_rockets', 'missile_shield'], { intercept: 0.25, missile: 0.3 }, '+25% interception, +30% missile damage.'),
  T('mars_program', 'Mars Colonization Program', 'space', 2045, 12000, ['reusable_rockets', 'fusion_research', 'ai_research'], { victory: 1 }, 'Completing this wins a Technology Victory.'),
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export const TECH_CATS: { id: TechCat; name: string }[] = [
  { id: 'land', name: 'Land' },
  { id: 'air', name: 'Air' },
  { id: 'naval', name: 'Naval' },
  { id: 'missile', name: 'Missiles & Nuclear' },
  { id: 'cyber', name: 'Cyber & Intel' },
  { id: 'economy', name: 'Economy' },
  { id: 'space', name: 'Space' },
];
