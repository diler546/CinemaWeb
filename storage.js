/**
 * Единственный ключ приложения. Другие данные localStorage не трогаем.
 * Все операции перехватывают ошибки: приватный режим, запрет записи, переполнение,
 * недоступное хранилище или повреждённый JSON не должны ломать интерфейс.
 */

export const STORAGE_KEY = 'kadr-cinema-bookings-v1';

const MESSAGES = {
  unavailable: 'Локальное хранилище недоступно. Брони не сохранятся после перезагрузки страницы.',
  parse: 'Сохранённые брони повреждены: JSON не читается. Приложение работает без них — повреждённые данные можно сбросить.',
  shape: 'Сохранённые брони имеют неверный формат. Приложение работает без них — данные можно сбросить.',
  save: 'Не удалось сохранить брони в браузере. Они останутся доступны только до перезагрузки страницы.',
  clear: 'Не удалось очистить хранилище браузера. Попробуйте ещё раз или проверьте настройки браузера.',
};

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredBookings() {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, code: 'unavailable', message: MESSAGES.unavailable, data: [] };
  }

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, code: 'unavailable', message: MESSAGES.unavailable, data: [] };
  }

  if (raw === null) {
    return { ok: true, data: [], empty: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'parse', message: MESSAGES.parse, data: [] };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, code: 'shape', message: MESSAGES.shape, data: [] };
  }

  return { ok: true, data: parsed, empty: false };
}

export function saveBookings(bookings) {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, message: MESSAGES.save };
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    return { ok: true };
  } catch {
    return { ok: false, message: MESSAGES.save };
  }
}

export function clearStoredBookings() {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, message: MESSAGES.clear };
  }

  try {
    storage.removeItem(STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, message: MESSAGES.clear };
  }
}
