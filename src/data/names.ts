// Name pools for procedurally generated generals and social-media authors.

const POOLS: Record<string, { first: string[]; last: string[] }> = {
  anglo: {
    first: ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Sarah', 'William', 'Karen', 'Thomas', 'Emily', 'Daniel', 'Grace', 'Mark', 'Olivia'],
    last: ['Smith', 'Johnson', 'Walker', 'Harris', 'Clarke', 'Bennett', 'Hughes', 'Morgan', 'Reed', 'Brooks', 'Hayes', 'Foster', 'Graham', 'Sullivan', 'Mitchell', 'Carter', 'Turner', 'Parker'],
  },
  slavic: {
    first: ['Ivan', 'Olga', 'Dmitri', 'Natalia', 'Sergei', 'Irina', 'Alexei', 'Yelena', 'Mikhail', 'Anna', 'Pavel', 'Tatiana', 'Viktor', 'Svetlana', 'Andriy', 'Oksana', 'Piotr', 'Katarzyna'],
    last: ['Volkov', 'Ivanova', 'Petrov', 'Sokolov', 'Kuznetsova', 'Morozov', 'Novak', 'Kovalenko', 'Lebedev', 'Orlov', 'Kowalski', 'Shevchenko', 'Popov', 'Zaitsev', 'Nowak', 'Bondarenko', 'Romanov', 'Belov'],
  },
  chinese: {
    first: ['Wei', 'Fang', 'Jun', 'Li', 'Hao', 'Ying', 'Qiang', 'Mei', 'Lei', 'Xiu', 'Bo', 'Ning', 'Tao', 'Hui', 'Chen', 'Lan'],
    last: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Huang', 'Zhou', 'Wu', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo'],
  },
  japanese: {
    first: ['Hiroshi', 'Yuki', 'Takeshi', 'Aiko', 'Kenji', 'Haruka', 'Daisuke', 'Sakura', 'Ryo', 'Naomi', 'Satoshi', 'Emi'],
    last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada'],
  },
  korean: {
    first: ['Min-jun', 'Seo-yeon', 'Ji-ho', 'Ha-eun', 'Hyun-woo', 'Ji-woo', 'Dong-hyun', 'Soo-ah'],
    last: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon'],
  },
  arabic: {
    first: ['Ahmed', 'Fatima', 'Omar', 'Layla', 'Khalid', 'Aisha', 'Youssef', 'Mariam', 'Hassan', 'Noor', 'Tariq', 'Salma', 'Faisal', 'Huda'],
    last: ['Al-Sayed', 'Haddad', 'Mansour', 'Khalil', 'Nasser', 'Hamdan', 'Saleh', 'Rahman', 'Farouk', 'Aziz', 'Qasim', 'Darwish'],
  },
  persian: {
    first: ['Ali', 'Zahra', 'Reza', 'Maryam', 'Hossein', 'Sara', 'Mehdi', 'Leila', 'Dariush', 'Shirin'],
    last: ['Hosseini', 'Rezaei', 'Mohammadi', 'Karimi', 'Ahmadi', 'Jafari', 'Rahimi', 'Moradi', 'Sadeghi', 'Bagheri'],
  },
  turkic: {
    first: ['Mehmet', 'Ayse', 'Emre', 'Elif', 'Murat', 'Zeynep', 'Aibek', 'Dana', 'Nurlan', 'Gulnara'],
    last: ['Yilmaz', 'Kaya', 'Demir', 'Celik', 'Sahin', 'Ozturk', 'Nurmagambetov', 'Aliyev', 'Karimov', 'Abdullaev'],
  },
  hispanic: {
    first: ['José', 'María', 'Carlos', 'Ana', 'Luis', 'Lucía', 'Miguel', 'Sofía', 'Javier', 'Valentina', 'Diego', 'Camila', 'Pedro', 'Isabel', 'João', 'Beatriz'],
    last: ['García', 'Rodríguez', 'Martínez', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Silva', 'Santos', 'Oliveira', 'Castro', 'Mendoza', 'Vargas'],
  },
  french: {
    first: ['Jean', 'Marie', 'Pierre', 'Camille', 'Louis', 'Chloé', 'Antoine', 'Juliette', 'Hugo', 'Léa', 'Marco', 'Giulia'],
    last: ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefèvre', 'Moreau', 'Laurent', 'Girard', 'Rossi', 'Ferrari', 'Bianchi', 'Romano'],
  },
  german: {
    first: ['Hans', 'Anna', 'Lukas', 'Lena', 'Felix', 'Hannah', 'Jonas', 'Mia', 'Erik', 'Ingrid', 'Lars', 'Astrid', 'Jan', 'Sanne'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Andersson', 'Hansen', 'Larsen', 'de Vries', 'Jansen', 'Virtanen'],
  },
  indian: {
    first: ['Arjun', 'Priya', 'Rahul', 'Ananya', 'Vikram', 'Kavya', 'Rohan', 'Isha', 'Imran', 'Ayesha', 'Sanjay', 'Deepa'],
    last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Reddy', 'Gupta', 'Khan', 'Rao', 'Mehta', 'Iyer', 'Chaudhry', 'Hussain'],
  },
  seasian: {
    first: ['Nguyen', 'Linh', 'Budi', 'Siti', 'Somchai', 'Mali', 'Jose', 'Maria', 'Arif', 'Dewi', 'Thanh', 'Anh'],
    last: ['Nguyen', 'Tran', 'Santoso', 'Wijaya', 'Srisuk', 'Reyes', 'Cruz', 'Rahman', 'Pham', 'Le', 'Tan', 'Lim'],
  },
  african: {
    first: ['Kwame', 'Amara', 'Chinedu', 'Ngozi', 'Tendai', 'Zanele', 'Kofi', 'Abena', 'Juma', 'Wanjiru', 'Moussa', 'Fatou', 'Thabo', 'Nomsa', 'Yaw', 'Aminata'],
    last: ['Mensah', 'Okafor', 'Mwangi', 'Diallo', 'Ndlovu', 'Banda', 'Traoré', 'Abebe', 'Kamau', 'Boateng', 'Mutua', 'Okonkwo', 'Keita', 'Moyo', 'Sesay', 'Haile'],
  },
  hebrew: {
    first: ['David', 'Noa', 'Yosef', 'Tamar', 'Eitan', 'Maya', 'Ariel', 'Shira'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Friedman', 'Katz', 'Shapiro'],
  },
};

export function cultureOf(id: string, cont: string, sub: string): string {
  if (['CHN', 'TWN', 'SGP', 'MAN'].includes(id)) return 'chinese';
  if (id === 'JPN') return 'japanese';
  if (id === 'KOR' || id === 'PRK') return 'korean';
  if (id === 'ISR') return 'hebrew';
  if (['IRN', 'AFG', 'TJK'].includes(id)) return 'persian';
  if (['TUR', 'OTT', 'KAZ', 'UZB', 'TKM', 'KGZ', 'AZE', 'CYN'].includes(id)) return 'turkic';
  if (['FRA', 'ITA', 'BEL', 'LUX', 'MCO', 'SMR', 'CHE'].includes(id)) return 'french';
  if (['DEU', 'AUT', 'AUH', 'NLD', 'DNK', 'NOR', 'SWE', 'FIN', 'ISL', 'LIE', 'DDR'].includes(id)) return 'german';
  if (['ESP', 'PRT', 'BRA', 'AND'].includes(id) || cont === 'South America' || sub === 'Central America' || sub === 'Caribbean' && !['JAM', 'BHS', 'TTO', 'BRB'].includes(id)) return 'hispanic';
  if (sub === 'Southern Asia') return 'indian';
  if (sub === 'South-Eastern Asia') return 'seasian';
  if (sub === 'Western Asia' || sub === 'Northern Africa') return 'arabic';
  if (cont === 'Africa') return 'african';
  if (sub === 'Eastern Europe' || ['SRB', 'HRV', 'SVN', 'BIH', 'MNE', 'MKD', 'BGR', 'EST', 'LVA', 'LTU', 'SOV', 'RUE', 'YUG', 'CSK', 'KOS', 'ALB', 'GEO', 'ARM', 'GRC'].includes(id)) return 'slavic';
  return 'anglo';
}

export function randomName(culture: string, rand: () => number): string {
  const p = POOLS[culture] || POOLS.anglo;
  const f = p.first[Math.floor(rand() * p.first.length)];
  const l = p.last[Math.floor(rand() * p.last.length)];
  return culture === 'chinese' || culture === 'korean' ? `${l} ${f}` : `${f} ${l}`;
}

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
}
export const TRAITS: TraitDef[] = [
  { id: 'defensive', name: 'Defensive Expert', desc: '+25% defense' },
  { id: 'blitz', name: 'Blitz Specialist', desc: '+25% armor attack, +20% speed' },
  { id: 'naval', name: 'Naval Genius', desc: '+30% naval combat' },
  { id: 'logistics', name: 'Logistician', desc: 'Units need 30% less supply' },
  { id: 'mountain', name: 'Mountaineer', desc: 'Ignores hill and mountain penalties' },
  { id: 'desert', name: 'Desert Fox', desc: 'Ignores desert penalties, +10% attack' },
  { id: 'jungle', name: 'Jungle Warfare', desc: 'Ignores jungle and marsh penalties' },
  { id: 'winter', name: 'Winter Expert', desc: 'Ignores snow and arctic penalties' },
  { id: 'air', name: 'Air Coordinator', desc: '+30% close air support' },
  { id: 'offensive', name: 'Aggressive Assaulter', desc: '+20% attack' },
  { id: 'organizer', name: 'Organizer', desc: '+30% organisation recovery' },
];

export const MILITARY_RANKS = ['Gen.', 'Gen.', 'Lt. Gen.', 'Maj. Gen.', 'Adm.'];

export const SOCIAL_HANDLES = ['citizen', 'patriot', 'worker', 'student', 'teacher', 'farmer', 'nurse', 'veteran', 'trader', 'mom', 'dad', 'engineer', 'reporter', 'artist', 'retiree'];
