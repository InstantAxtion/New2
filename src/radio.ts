// Built-in internet radio: free, listener-supported SomaFM stations (somafm.com).

export interface Station {
  id: string;
  name: string;
  about: string;
}

export const STATIONS: Station[] = [
  { id: 'groovesalad', name: 'Groove Salad', about: 'Chilled ambient and downtempo beats' },
  { id: 'lush', name: 'Lush', about: 'Sensuous, mellow vocals, mostly female' },
  { id: 'indiepop', name: 'Indie Pop Rocks!', about: 'New and classic indie pop' },
  { id: 'beatblender', name: 'Beat Blender', about: 'Late-night deep house and chill' },
  { id: 'seventies', name: 'Left Coast 70s', about: 'Mellow album rock from the seventies' },
  { id: 'folkfwd', name: 'Folk Forward', about: 'Indie folk, alt-folk, classic folk' },
  { id: 'secretagent', name: 'Secret Agent', about: 'Spy-movie lounge for your drive' },
  { id: 'dronezone', name: 'Drone Zone', about: 'Atmospheric ambient for night drives' },
  { id: 'synphaera', name: 'Synphaera Radio', about: 'Modern electronic ambient and space music' },
  { id: 'u80s', name: 'Underground 80s', about: 'Early 80s UK synthpop and new wave' },
];

export class Radio {
  private audio: HTMLAudioElement | null = null;
  station: Station | null = null;
  playing = false;
  error = '';
  onChange: () => void = () => {};
  private vol = 1;

  play(st: Station) {
    this.stop();
    const a = new Audio(`https://ice1.somafm.com/${st.id}-128-mp3`);
    a.preload = 'none';
    a.volume = this.vol;
    a.onplaying = () => {
      this.playing = true;
      this.error = '';
      this.onChange();
    };
    a.onerror = () => {
      this.playing = false;
      this.error = "Couldn't reach the station. Check your internet connection.";
      this.onChange();
    };
    this.audio = a;
    this.station = st;
    this.error = '';
    void a.play().catch(() => {
      this.error = 'Tap the station again to start it.';
      this.onChange();
    });
    this.onChange();
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this.playing = false;
    this.onChange();
  }

  setVolume(v: number) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.vol;
  }
}
