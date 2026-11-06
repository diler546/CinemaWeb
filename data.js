/**
 * Данные афиши и схема зала.
 *
 * Постеры лежат в папке img/. Чтобы заменить картинку, положите свой файл
 * в img/ и укажите его имя в поле poster у нужного фильма.
 * Текущие имена: Forgotten-Island.webp, Resident-Evil.jpg, Spider-Man.jpg,
 * The Odyssey.jpg. Можно использовать и стандартные film1.jpg … film4.jpg.
 *
 * Все восемь сеансов получают собственную стабильную «случайную» занятость:
 * при перезагрузке страницы она не меняется, а брони пользователя накладываются сверху.
 */

export const TICKET_PRICE = 450;
export const ROWS = 4;
export const SEATS_PER_ROW = 6;
export const SEATS_TOTAL = ROWS * SEATS_PER_ROW;

export const films = [
  {
    id: 'film-northern-light',
    title: 'Остров забвения',
    genre: 'Комедия',
    duration: 118,
    rating: '12+',
    year: 2026,
    tagline: 'Свет возвращается туда, где его ждут.',
    poster: 'img/Forgotten-Island.webp',
    palette: { from: '#0d5c63', to: '#06171b', accent: '#64f4d2' },
    sessions: [
      { id: 's1', time: '14:00', hall: 'Зал 1', format: '2D' },
      { id: 's2', time: '18:30', hall: 'Зал 2', format: '2D' },
    ],
  },
  {
    id: 'film-red-line',
    title: 'Обитель зла',
    genre: 'Триллер',
    duration: 124,
    rating: '18+',
    year: 2025,
    tagline: 'Одна ошибка. Восемь минут до полуночи.',
    poster: 'img/Resident-Evil.jpg',
    palette: { from: '#7c1d24', to: '#1a070a', accent: '#ff6b57' },
    sessions: [
      { id: 's1', time: '14:00', hall: 'Зал 2', format: '2D' },
      { id: 's2', time: '18:30', hall: 'Зал 1', format: '2D' },
    ],
  },
  {
    id: 'film-depth',
    title: 'Человек-паук новый день',
    genre: 'Фантастика',
    duration: 132,
    rating: '12+',
    year: 2026,
    tagline: 'Обратно к истокам.',
    poster: 'img/Spider-Man.jpg',
    palette: { from: '#1b2a6b', to: '#080c20', accent: '#7aa7ff' },
    sessions: [
      { id: 's1', time: '14:00', hall: 'Зал 1', format: '2D' },
      { id: 's2', time: '18:30', hall: 'Зал 2', format: '2D' },
    ],
  },
  {
    id: 'film-last-show',
    title: 'Одиссея',
    genre: 'Фантастика',
    duration: 104,
    rating: '16+',
    year: 2025,
    tagline: 'Сегодня всё пойдёт не по сценарию.',
    poster: 'img/The Odyssey.jpg',
    palette: { from: '#805112', to: '#1c1007', accent: '#ffd166' },
    sessions: [
      { id: 's1', time: '14:00', hall: 'Зал 2', format: '2D' },
      { id: 's2', time: '18:30', hall: 'Зал 1', format: '2D' },
    ],
  },
];

export function getFilm(filmId) {
  return films.find((film) => film.id === filmId) ?? null;
}

export function getSession(filmId, sessionId) {
  const film = getFilm(filmId);
  return film?.sessions.find((session) => session.id === sessionId) ?? null;
}

export function seatKey(row, seat) {
  return `${row}-${seat}`;
}

export function parseSeatKey(key) {
  const [row, seat] = String(key).split('-').map(Number);
  return Number.isInteger(row) && Number.isInteger(seat) ? { row, seat } : null;
}

/** Простой детерминированный ГПСЧ, чтобы занятость была «случайной», но стабильной. */
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed;
  return function random() {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBaseOccupancy(filmId, sessionId) {
  const seed = hashString(`${filmId}:${sessionId}`);
  const random = mulberry32(seed);
  const count = 2 + (seed % 2);
  const used = new Set();
  const seats = [];

  while (seats.length < count) {
    const row = 1 + Math.floor(random() * ROWS);
    const seat = 1 + Math.floor(random() * SEATS_PER_ROW);
    const key = seatKey(row, seat);
    if (used.has(key)) continue;
    used.add(key);
    seats.push({ row, seat });
  }

  return seats.sort((first, second) => first.row - second.row || first.seat - second.seat);
}

const baseOccupancy = new Map();

for (const film of films) {
  for (const session of film.sessions) {
    baseOccupancy.set(`${film.id}:${session.id}`, buildBaseOccupancy(film.id, session.id));
  }
}

export function getBaseOccupied(filmId, sessionId) {
  return baseOccupancy.get(`${filmId}:${sessionId}`) ?? [];
}
