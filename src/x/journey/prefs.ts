/** A road trip in progress: somewhere real further along this road. */
export interface ActiveTrip {
  name: string;
  icon: string;
  /** The world it belongs to (a different road cancels it quietly). */
  seed: number;
  /** Where it was set and where it ends, along the road. */
  z0: number;
  z1: number;
  at: number;
}

export interface DoneTrip {
  name: string;
  icon: string;
  /** Metres from where it was set to the destination. */
  m: number;
  at: number;
}

/** Today's tallies, for the daily ideas (started afresh each day). */
export interface DayTally {
  day: string;
  n: Record<string, number>;
  /** Things counted once each (regions, cars, kinds of stop…). */
  seen: Record<string, string[]>;
  /** Ideas ticked off today. */
  done: string[];
}

/** Saved choices and progress for journeys (under `settings.x.journey`). */
export interface JourneyPrefs {
  [key: string]: unknown;
  trip: ActiveTrip | null;
  tripsDone: DoneTrip[];
  /** Days you've driven on (YYYY-MM-DD), newest last. */
  days: string[];
  /** Days you drove the road of the day. */
  dailyDone: string[];
  today: DayTally;
  /** Lifetime tallies: metres in rain, at night, and so on. */
  life: Record<string, number>;
  /** Milestones reached, and when. */
  milestones: Record<string, number>;
  /** Ideas ticked off, all time. */
  ideasDone: number;
  /** The tab the Journeys screen was last on. */
  tab: string;
  /** Show the summary card after a drive. */
  summary: boolean;
}

export const JOURNEY_DEFAULTS: JourneyPrefs = {
  trip: null,
  tripsDone: [],
  days: [],
  dailyDone: [],
  today: { day: '', n: {}, seen: {}, done: [] },
  life: {},
  milestones: {},
  ideasDone: 0,
  tab: 'trips',
  summary: true,
};
