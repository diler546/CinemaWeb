import {
  films,
  getFilm,
  getSession,
  getBaseOccupied,
  parseSeatKey,
  seatKey,
  ROWS,
  SEATS_PER_ROW,
  SEATS_TOTAL,
  TICKET_PRICE,
} from './data.js';
import { loadStoredBookings, saveBookings, clearStoredBookings } from './storage.js';

const dom = {
  navTicketsLink: document.getElementById('nav-tickets-link'),
  navTicketCount: document.getElementById('nav-ticket-count'),
  notices: document.getElementById('notices'),
  filmList: document.getElementById('film-list'),
  sessionPanel: document.getElementById('session-panel'),
  hallTitle: document.getElementById('hall-title'),
  hallFilm: document.getElementById('hall-film'),
  hallSession: document.getElementById('hall-session'),
  hallStage: document.getElementById('hall-stage'),
  hallGrid: document.getElementById('hall-grid'),
  orderPanel: document.getElementById('order-panel'),
  ticketsTitle: document.getElementById('tickets-title'),
  ticketsCount: document.getElementById('tickets-count'),
  ticketsList: document.getElementById('tickets-list'),
  resetButton: document.getElementById('reset-all'),
  resetDialog: document.getElementById('reset-dialog'),
  toast: document.getElementById('toast'),
};

const firstFilm = films[0];
const state = {
  filmId: firstFilm.id,
  sessionId: firstFilm.sessions[0].id,
  selectedSeats: new Set(),
  bookings: [],
  notices: [],
  orderError: '',
  success: '',
  needsReset: false,
};

const moneyFormatter = new Intl.NumberFormat('ru-RU');
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const BOOKING_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOOKING_CODE_RE = /^KD-[A-Z2-9]{4}$/;

let noticeCounter = 0;
let toastTimer = 0;
const baseSeatSets = new Map();

/* ---------- Утилиты ---------- */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

function formatMoney(value) {
  return `${moneyFormatter.format(value)} ₽`;
}

function plural(count, one, few, many) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function formatDate(isoDate) {
  const parsed = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? isoDate : dateFormatter.format(parsed);
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentFilm() {
  return getFilm(state.filmId);
}

function currentSession() {
  return getSession(state.filmId, state.sessionId);
}

function selectedSeats() {
  return [...state.selectedSeats]
    .map(parseSeatKey)
    .filter(Boolean)
    .sort((first, second) => first.row - second.row || first.seat - second.seat);
}

function baseSet(filmId, sessionId) {
  const key = `${filmId}:${sessionId}`;
  if (!baseSeatSets.has(key)) {
    baseSeatSets.set(key, new Set(getBaseOccupied(filmId, sessionId).map((seat) => seatKey(seat.row, seat.seat))));
  }
  return baseSeatSets.get(key);
}

function getSessionOccupancy(filmId, sessionId) {
  const occupied = new Set(baseSet(filmId, sessionId));
  for (const booking of state.bookings) {
    if (booking.filmId !== filmId || booking.sessionId !== sessionId) continue;
    for (const seat of booking.seats) {
      occupied.add(seatKey(seat.row, seat.seat));
    }
  }
  return occupied;
}

function countFreeSeats(filmId, sessionId) {
  return SEATS_TOTAL - getSessionOccupancy(filmId, sessionId).size;
}

function posterStyle(film) {
  return `--poster-a:${film.palette.from};--poster-b:${film.palette.to};--poster-accent:${film.palette.accent}`;
}

/* ---------- Сообщения ---------- */

function addNotice(text, type = 'error', source = 'storage') {
  if (state.notices.some((notice) => notice.text === text)) return;
  state.notices.push({
    id: ++noticeCounter,
    text,
    type,
    source,
  });
  renderNotices();
}

function clearDataNotices() {
  const before = state.notices.length;
  state.notices = state.notices.filter((notice) => notice.source !== 'data');
  if (state.notices.length !== before) renderNotices();
}

function renderNotices() {
  dom.notices.innerHTML = state.notices
    .map(
      (notice) => `
        <div class="notice notice--${notice.type}" role="${notice.type === 'error' ? 'alert' : 'status'}">
          <span>${escapeHtml(notice.text)}</span>
          <button class="notice__close" type="button" data-action="dismiss-notice" data-notice-id="${notice.id}" aria-label="Скрыть сообщение">×</button>
        </div>`,
    )
    .join('');
}

function showToast(text) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = text;
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, 4200);
}

/* ---------- Восстановление и проверка сохранённых данных ---------- */

function parseBooking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const { id, code, filmId, sessionId, seats, total, createdAt, showDate } = value;
  if (typeof id !== 'string' || !BOOKING_ID_RE.test(id)) return null;
  if (typeof code !== 'string' || !BOOKING_CODE_RE.test(code)) return null;
  if (typeof filmId !== 'string' || !getFilm(filmId)) return null;
  if (typeof sessionId !== 'string' || !getSession(filmId, sessionId)) return null;
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > SEATS_TOTAL) return null;

  const seenSeats = new Set();
  const normalizedSeats = [];

  for (const seat of seats) {
    if (!seat || typeof seat !== 'object') return null;
    const row = seat.row;
    const seatNumber = seat.seat;
    if (!Number.isInteger(row) || row < 1 || row > ROWS) return null;
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > SEATS_PER_ROW) return null;

    const key = seatKey(row, seatNumber);
    if (seenSeats.has(key)) return null;
    seenSeats.add(key);
    normalizedSeats.push({ row, seat: seatNumber });
  }

  normalizedSeats.sort((first, second) => first.row - second.row || first.seat - second.seat);

  if (typeof total !== 'number' || !Number.isFinite(total) || total !== normalizedSeats.length * TICKET_PRICE) {
    return null;
  }

  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;

  const createdAtDate = new Date(createdAt);
  const safeShowDate =
    typeof showDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(showDate)
      ? showDate
      : toLocalISODate(createdAtDate);

  if (Number.isNaN(new Date(`${safeShowDate}T12:00:00`).getTime())) return null;

  return {
    id,
    code,
    filmId,
    sessionId,
    seats: normalizedSeats,
    total,
    createdAt,
    showDate: safeShowDate,
  };
}

function restoreBookings() {
  const stored = loadStoredBookings();

  if (!stored.ok) {
    addNotice(stored.message, 'error', 'data');
    if (stored.code === 'parse' || stored.code === 'shape') state.needsReset = true;
    return;
  }

  if (stored.empty || stored.data.length === 0) return;

  const valid = [];
  const usedIds = new Set();
  const usedCodes = new Set();
  const usedSeats = new Set();
  let dropped = 0;

  for (const item of stored.data) {
    const booking = parseBooking(item);
    if (!booking || usedIds.has(booking.id) || usedCodes.has(booking.code)) {
      dropped += 1;
      continue;
    }

    const base = baseSet(booking.filmId, booking.sessionId);
    const hasConflict = booking.seats.some((seat) => {
      const key = seatKey(seat.row, seat.seat);
      return base.has(key) || usedSeats.has(`${booking.filmId}:${booking.sessionId}:${key}`);
    });

    if (hasConflict) {
      dropped += 1;
      continue;
    }

    usedIds.add(booking.id);
    usedCodes.add(booking.code);
    for (const seat of booking.seats) {
      usedSeats.add(`${booking.filmId}:${booking.sessionId}:${seatKey(seat.row, seat.seat)}`);
    }
    valid.push(booking);
  }

  state.bookings = valid;

  if (dropped > 0) {
    state.needsReset = true;
    addNotice(
      `Пропущено ${dropped} ${plural(dropped, 'сохранённая бронь', 'сохранённые брони', 'сохранённых броней')} с некорректными данными.`,
      'warning',
      'data',
    );
  }
}

/* ---------- Отрисовка: афиша и сеансы ---------- */

function renderFilms() {
  dom.filmList.innerHTML = films
    .map((film, index) => {
      const isSelected = film.id === state.filmId;
      return `
        <button
          class="film-card"
          type="button"
          data-action="select-film"
          data-film-id="${film.id}"
          data-focus-key="film-${film.id}"
          aria-pressed="${isSelected}"
        >
          <span class="poster poster--${film.posterStyle}" style="${posterStyle(film)}">
            <span class="poster__orb" aria-hidden="true"></span>
            <span class="film-card__selected" aria-hidden="true">Выбран</span>
            <span class="poster__rating">${film.rating}</span>
            <span class="poster__index">0${index + 1}</span>
            <span class="poster__word" aria-hidden="true">${film.posterWord}</span>
          </span>
          <span class="film-card__body">
            <span class="film-card__meta">${film.genre} · ${film.duration} мин</span>
            <span class="film-card__title">${film.title}</span>
            <span class="film-card__bottom">
              <span class="rating">${film.rating}</span>
              <span class="film-card__price">${formatMoney(TICKET_PRICE)}</span>
            </span>
          </span>
        </button>`;
    })
    .join('');
}

function renderSessionPanel() {
  const film = currentFilm();

  dom.sessionPanel.innerHTML = `
    <div class="session-film">
      <span class="session-film__thumb" style="${posterStyle(film)}" aria-hidden="true">
        <span>${film.posterWord}</span>
      </span>
      <div>
        <p class="session-film__label">Выбранный фильм</p>
        <h3>${film.title}</h3>
        <p class="session-film__meta">${film.genre} · ${film.duration} мин · ${film.rating}</p>
      </div>
    </div>
    <div class="session-options" role="group" aria-label="Сеансы фильма «${film.title}»">
      ${film.sessions
        .map((session) => {
          const free = countFreeSeats(film.id, session.id);
          const isSelected = session.id === state.sessionId;
          const freeLabel = free === 0 ? 'Мест нет' : `${free} ${plural(free, 'место', 'места', 'мест')}`;
          return `
            <button
              class="session${free === 0 ? ' session--soldout' : ''}"
              type="button"
              data-action="select-session"
              data-session-id="${session.id}"
              data-focus-key="session-${film.id}-${session.id}"
              aria-pressed="${isSelected}"
            >
              <span class="session__time">${session.time}</span>
              <span class="session__hall">${session.hall} · ${session.format}</span>
              <span class="session__free">${freeLabel}</span>
            </button>`;
        })
        .join('')}
    </div>`;
}

/* ---------- Отрисовка: схема зала ---------- */

function renderHall() {
  const film = currentFilm();
  const session = currentSession();
  const occupied = getSessionOccupancy(film.id, session.id);

  dom.hallTitle.textContent = session.hall;
  dom.hallFilm.textContent = film.title;
  dom.hallSession.textContent = `${session.time} · ${session.format}`;
  dom.hallStage.setAttribute(
    'aria-label',
    `Схема ${session.hall}: ${ROWS} ряда по ${SEATS_PER_ROW} мест, экран внизу. Фильм «${film.title}», сеанс ${session.time}.`,
  );

  const rows = [];

  for (let row = 1; row <= ROWS; row += 1) {
    const seats = [];

    for (let seat = 1; seat <= SEATS_PER_ROW; seat += 1) {
      const key = seatKey(row, seat);
      const isOccupied = occupied.has(key);
      const isSelected = state.selectedSeats.has(key);
      const status = isOccupied ? 'Занято' : isSelected ? 'Выбрано' : 'Свободно';
      const modifier = isOccupied ? 'seat--occupied' : isSelected ? 'seat--selected' : 'seat--free';

      seats.push(`
        <button
          class="seat ${modifier}"
          type="button"
          data-action="toggle-seat"
          data-row="${row}"
          data-seat="${seat}"
          data-seat-key="${key}"
          data-focus-key="seat-${film.id}-${session.id}-${key}"
          aria-label="Ряд ${row}, Место ${seat}, ${status}"
          aria-pressed="${isSelected}"
          ${isOccupied ? 'disabled' : ''}
        ><span aria-hidden="true">${seat}</span></button>`);
    }

    rows.push(`
      <div class="seat-row" role="group" aria-label="Ряд ${row}">
        <span class="row-label" aria-hidden="true">${row}</span>
        ${seats.join('')}
      </div>`);
  }

  dom.hallGrid.innerHTML = rows.join('');
}

/* ---------- Отрисовка: заказ ---------- */

function renderOrder() {
  const film = currentFilm();
  const session = currentSession();
  const seats = selectedSeats();
  const count = seats.length;
  const total = count * TICKET_PRICE;
  const countLabel = `${count} ${plural(count, 'место', 'места', 'мест')}`;

  const chips = seats
    .map(
      (seat) => `
        <li>
          <button
            class="selected-chip"
            type="button"
            data-action="remove-seat"
            data-seat-key="${seatKey(seat.row, seat.seat)}"
            aria-label="Убрать место: Ряд ${seat.row}, Место ${seat.seat}"
          >
            <span>Ряд ${seat.row} · место ${seat.seat}</span>
            <span class="selected-chip__icon" aria-hidden="true">×</span>
          </button>
        </li>`,
    )
    .join('');

  const feedback = state.orderError
    ? `<div class="feedback feedback--error" role="alert">${escapeHtml(state.orderError)}</div>`
    : state.success
      ? `<div class="feedback feedback--success" role="status" aria-live="polite">
           ${escapeHtml(state.success)}
           <br><a class="feedback__link" href="#tickets">Открыть «Мои билеты»</a>
         </div>`
      : '';

  dom.orderPanel.innerHTML = `
    <div class="order-head">
      <h2 class="order-title">Ваш заказ</h2>
      <span class="order-count">${countLabel}</span>
    </div>

    <div class="order-film">
      <span class="order-poster" style="${posterStyle(film)}" aria-hidden="true"><span>${film.posterWord}</span></span>
      <div class="order-film__info">
        <h3>${film.title}</h3>
        <p>${session.time} · ${session.hall} · ${session.format}</p>
      </div>
    </div>

    <div class="selection-block">
      <span class="selection-label">Выбранные места</span>
      ${
        count === 0
          ? '<p class="selection-empty">Пока ничего не выбрано. Нажмите на свободное место в схеме зала — можно выбрать сразу несколько.</p>'
          : `<ul class="selected-chips">${chips}</ul>`
      }
    </div>

    <div class="order-summary">
      <div class="summary-row">
        <span>Билеты (${count} × ${formatMoney(TICKET_PRICE)})</span>
        <span>${formatMoney(total)}</span>
      </div>
      <div class="summary-row summary-total">
        <span>Итого</span>
        <strong>${formatMoney(total)}</strong>
      </div>
    </div>

    <button class="order-button" id="book-button" type="button" data-action="book" data-focus-key="book-button">
      Забронировать билеты
    </button>
    <p class="order-note">Учебное демо: реальная бронь и оплата не оформляются.</p>
    ${feedback}`;
}

/* ---------- Отрисовка: мои билеты ---------- */

function renderTickets() {
  const count = state.bookings.length;
  const countLabel = `${count} ${plural(count, 'билет', 'билета', 'билетов')}`;

  dom.navTicketCount.textContent = String(count);
  dom.navTicketsLink.setAttribute('aria-label', `Мои билеты: ${countLabel}`);
  dom.ticketsCount.textContent = String(count);
  dom.resetButton.disabled = count === 0 && !state.needsReset;

  if (count === 0) {
    dom.ticketsList.innerHTML = `
      <div class="tickets-empty">
        <span class="tickets-empty__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v1.2a2.3 2.3 0 0 0 0 4.6v1.2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-1.2a2.3 2.3 0 0 0 0-4.6V8.5Z"></path>
            <path d="M14.5 6v12" stroke-dasharray="2 2.4"></path>
          </svg>
        </span>
        <h3>Пока ни одного билета</h3>
        <p>Выберите фильм и свободные места — оформленная бронь появится здесь и сохранится в этом браузере.</p>
        <a href="#showtime">Перейти к афише</a>
      </div>`;
    return;
  }

  const bookings = [...state.bookings].sort(
    (first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt),
  );

  dom.ticketsList.innerHTML = bookings
    .map((booking) => {
      const film = getFilm(booking.filmId);
      const session = getSession(booking.filmId, booking.sessionId);
      if (!film || !session) return '';

      const seatPills = booking.seats
        .map((seat) => `<span class="seat-pill">Ряд ${seat.row} · место ${seat.seat}</span>`)
        .join('');
      const seatsLabel = booking.seats
        .map((seat) => `Ряд ${seat.row}, место ${seat.seat}`)
        .join('; ');
      const ticketsLabel = `${booking.seats.length} ${plural(booking.seats.length, 'билет', 'билета', 'билетов')}`;
      const cancelLabel = `Отменить бронь ${booking.code}: ${film.title}, сеанс ${session.time}`;

      return `
        <article class="ticket" style="--ticket-a:${film.palette.from};--ticket-b:${film.palette.to}">
          <div class="ticket__main">
            <div class="ticket__top">
              <span>КАДР · Кинобилет</span>
              <span class="ticket__code">№ ${escapeHtml(booking.code)}</span>
            </div>
            <h3>${escapeHtml(film.title)}</h3>
            <div class="ticket__meta">
              <div><span>Дата</span><strong>${formatDate(booking.showDate)}</strong></div>
              <div><span>Сеанс</span><strong>${session.time}</strong></div>
              <div><span>Зал</span><strong>${session.hall}</strong></div>
            </div>
            <div class="ticket__seats" role="group" aria-label="Места: ${seatsLabel}">
              ${seatPills}
            </div>
          </div>
          <div class="ticket__stub">
            <span class="ticket__price-label">${ticketsLabel}</span>
            <strong class="ticket__price">${formatMoney(booking.total)}</strong>
            <button
              class="btn btn--danger-ghost"
              type="button"
              data-action="cancel-booking"
              data-booking-id="${escapeHtml(booking.id)}"
              data-focus-key="cancel-${escapeHtml(booking.id)}"
              aria-label="${escapeHtml(cancelLabel)}"
            >Отменить бронь</button>
          </div>
        </article>`;
    })
    .join('');
}

/* ---------- Общая отрисовка ---------- */

function render(focusKey = null, keepScroll = true) {
  const activeElement = document.activeElement;
  const keyToRestore = focusKey ?? activeElement?.dataset?.focusKey ?? null;
  const filmRailScroll = dom.filmList.scrollLeft;

  renderFilms();
  dom.filmList.scrollLeft = filmRailScroll;
  renderSessionPanel();
  renderHall();
  renderOrder();
  renderTickets();

  if (keyToRestore) {
    const target = [...document.querySelectorAll('[data-focus-key]')].find(
      (element) => element.dataset.focusKey === keyToRestore,
    );
    if (target) {
      target.focus({ preventScroll: keepScroll });
    }
  }
}

/* ---------- Действия ---------- */

function clearTransientState() {
  state.selectedSeats.clear();
  state.orderError = '';
  state.success = '';
}

function selectFilm(filmId) {
  const film = getFilm(filmId);
  if (!film || film.id === state.filmId) return;

  state.filmId = film.id;
  state.sessionId = film.sessions[0].id;
  clearTransientState();
  render(`film-${film.id}`);
}

function selectSession(sessionId) {
  const session = getSession(state.filmId, sessionId);
  if (!session || session.id === state.sessionId) return;

  state.sessionId = session.id;
  clearTransientState();
  render(`session-${state.filmId}-${session.id}`);
}

function toggleSeat(row, seat) {
  if (!Number.isInteger(row) || !Number.isInteger(seat)) return;
  if (row < 1 || row > ROWS || seat < 1 || seat > SEATS_PER_ROW) return;

  const key = seatKey(row, seat);
  const occupied = getSessionOccupancy(state.filmId, state.sessionId);
  if (occupied.has(key)) return;

  if (state.selectedSeats.has(key)) {
    state.selectedSeats.delete(key);
  } else {
    state.selectedSeats.add(key);
  }

  state.orderError = '';
  state.success = '';
  render(`seat-${state.filmId}-${state.sessionId}-${key}`);
}

function removeSeat(key) {
  const seat = parseSeatKey(key);
  if (!seat) return;

  state.selectedSeats.delete(key);
  state.orderError = '';
  state.success = '';
  render('book-button');
}

function createBookingId() {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createBookingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  do {
    code = `KD-${Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
  } while (state.bookings.some((booking) => booking.code === code));

  return code;
}

function bookSelectedSeats() {
  const film = currentFilm();
  const session = currentSession();

  state.orderError = '';
  state.success = '';

  if (state.selectedSeats.size === 0) {
    state.orderError = 'Выберите хотя бы одно свободное место на схеме зала.';
    render('book-button');
    return;
  }

  const chosen = selectedSeats();
  const occupied = getSessionOccupancy(film.id, session.id);
  const conflicting = chosen.filter((seat) => occupied.has(seatKey(seat.row, seat.seat)));

  if (chosen.length === 0 || conflicting.length > 0) {
    for (const seat of conflicting) {
      state.selectedSeats.delete(seatKey(seat.row, seat.seat));
    }
    state.orderError = 'Некоторые места уже заняты. Мы убрали их из выбора — попробуйте снова.';
    render('book-button');
    return;
  }

  const now = new Date();
  const booking = {
    id: createBookingId(),
    code: createBookingCode(),
    filmId: film.id,
    sessionId: session.id,
    seats: chosen,
    total: chosen.length * TICKET_PRICE,
    createdAt: now.toISOString(),
    showDate: toLocalISODate(now),
  };

  const nextBookings = [...state.bookings, booking];
  const result = saveBookings(nextBookings);

  state.bookings = nextBookings;
  state.selectedSeats.clear();
  state.success = `Билеты забронированы. Номер заказа — ${booking.code}.`;

  if (result.ok) {
    state.needsReset = false;
    clearDataNotices();
  } else {
    addNotice(result.message, 'error', 'save');
  }

  render('book-button');
  showToast(`Готово: ${chosen.length} ${plural(chosen.length, 'место', 'места', 'мест')} в «Моих билетах»`);
}

function cancelBooking(bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) return;

  const nextBookings = state.bookings.filter((item) => item.id !== bookingId);
  const result = saveBookings(nextBookings);

  state.bookings = nextBookings;
  state.orderError = '';
  state.success = '';

  if (result.ok) {
    state.needsReset = false;
    clearDataNotices();
  } else {
    addNotice(result.message, 'error', 'save');
  }

  render('tickets-title');
  showToast(`Бронь ${booking.code} отменена — места снова свободны`);
}

function resetAllBookings() {
  const result = clearStoredBookings();

  if (!result.ok) {
    addNotice(result.message, 'error', 'storage');
    showToast('Не удалось сбросить брони');
    return;
  }

  state.bookings = [];
  state.selectedSeats.clear();
  state.orderError = '';
  state.success = '';
  state.needsReset = false;
  clearDataNotices();

  render('tickets-title');
  showToast('Все брони сброшены — места снова свободны');
}

/* ---------- События ---------- */

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;

  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) return;

  switch (actionElement.dataset.action) {
    case 'select-film':
      selectFilm(actionElement.dataset.filmId);
      break;
    case 'select-session':
      selectSession(actionElement.dataset.sessionId);
      break;
    case 'toggle-seat':
      toggleSeat(Number(actionElement.dataset.row), Number(actionElement.dataset.seat));
      break;
    case 'remove-seat':
      removeSeat(actionElement.dataset.seatKey);
      break;
    case 'book':
      bookSelectedSeats();
      break;
    case 'cancel-booking':
      cancelBooking(actionElement.dataset.bookingId);
      break;
    case 'dismiss-notice': {
      const noticeId = Number(actionElement.dataset.noticeId);
      state.notices = state.notices.filter((notice) => notice.id !== noticeId);
      renderNotices();
      break;
    }
    default:
      break;
  }
});

dom.resetButton.addEventListener('click', () => {
  if (dom.resetButton.disabled) return;
  dom.resetDialog.returnValue = '';
  dom.resetDialog.showModal();
});

dom.resetDialog.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const action = event.submitter?.value;
  dom.resetDialog.close();
  if (action === 'confirm') {
    resetAllBookings();
  }
});

/* ---------- Запуск ---------- */

restoreBookings();
render();
