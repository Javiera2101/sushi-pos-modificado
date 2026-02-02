/**
 * Obtiene la fecha actual en formato local YYYY-MM-DD.
 * Soluciona el problema de cambio de día adelantado por zona horaria UTC.
 */
export const getTodayDateString = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Obtiene la hora actual en formato HH:MM local
 */
export const getCurrentTime = () => {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * Formatea una fecha YYYY-MM-DD a DD/MM/YYYY para visualización
 */
export const formatDisplayDate = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
};