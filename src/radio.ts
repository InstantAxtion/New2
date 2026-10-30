// Built-in internet radio: free, listener-supported SomaFM stations (somafm.com).

export interface Station {
  id: string;
  name: string;
  about: string;
  genre: string;
}

export const STATIONS: Station[] = [
  { id: 'groovesalad', name: 'Groove Salad', about: 'Chilled ambient and downtempo beats', genre: 'Chill' },
  { id: 'lush', name: 'Lush', about: 'Sensuous, mellow vocals, mostly female', genre: 'Chill' },
  { id: 'fluid', name: 'Fluid', about: 'Instrumental hip-hop and future soul', genre: 'Chill' },
  { id: 'illstreet', name: 'Illinois Street Lounge', about: 'Classic bachelor-pad lounge and exotica', genre: 'Chill' },
  { id: 'indiepop', name: 'Indie Pop Rocks!', about: 'New and classic indie pop', genre: 'Pop & rock' },
  { id: 'bagel', name: 'BAGeL Radio', about: 'Alternative rock, old and new', genre: 'Pop & rock' },
  { id: 'poptron', name: 'PopTron', about: 'Electropop and indie dance rock', genre: 'Pop & rock' },
  { id: 'seventies', name: 'Left Coast 70s', about: 'Mellow album rock from the seventies', genre: 'Pop & rock' },
  { id: 'u80s', name: 'Underground 80s', about: 'Early 80s UK synthpop and new wave', genre: 'Pop & rock' },
  { id: 'covers', name: 'Covers', about: 'Songs you know, by artists you might not', genre: 'Pop & rock' },
  { id: 'metal', name: 'Metal Detector', about: 'From black to doom, thrash to power', genre: 'Pop & rock' },
  { id: 'beatblender', name: 'Beat Blender', about: 'Late-night deep house and chill', genre: 'Electronic' },
  { id: 'thetrip', name: 'The Trip', about: 'Progressive house and trance', genre: 'Electronic' },
  { id: 'cliqhop', name: 'cliqhop idm', about: 'Blips, beeps and intelligent dance music', genre: 'Electronic' },
  { id: 'vaporwaves', name: 'Vaporwaves', about: 'All vaporwave, all the time', genre: 'Electronic' },
  { id: 'suburbsofgoa', name: 'Suburbs of Goa', about: 'Desi-influenced Asian world beats', genre: 'Electronic' },
  { id: 'folkfwd', name: 'Folk Forward', about: 'Indie folk, alt-folk, classic folk', genre: 'Folk & country' },
  { id: 'bootliquor', name: 'Boot Liquor', about: 'Americana roots music', genre: 'Folk & country' },
  { id: 'thistle', name: 'ThistleRadio', about: 'Celtic music, old and new', genre: 'Folk & country' },
  { id: 'sonicuniverse', name: 'Sonic Universe', about: 'Avant-garde, nu and transcendental jazz', genre: 'Jazz & lounge' },
  { id: 'secretagent', name: 'Secret Agent', about: 'Spy-movie lounge for your drive', genre: 'Jazz & lounge' },
  { id: 'reggae', name: 'Heavyweight Reggae', about: 'Reggae, ska and rocksteady', genre: 'Jazz & lounge' },
  { id: 'dronezone', name: 'Drone Zone', about: 'Atmospheric ambient for night drives', genre: 'Ambient' },
  { id: 'deepspaceone', name: 'Deep Space One', about: 'Deep ambient electronic and space music', genre: 'Ambient' },
  { id: 'spacestation', name: 'Space Station Soma', about: 'Spaced-out ambient and mid-tempo electronica', genre: 'Ambient' },
  { id: 'synphaera', name: 'Synphaera Radio', about: 'Modern electronic ambient and space music', genre: 'Ambient' },
  { id: 'missioncontrol', name: 'Mission Control', about: 'Ambient music mixed with real NASA radio chatter', genre: 'Ambient' },
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
