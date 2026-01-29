// sushi/src/utils/dateUtils.js

// Obtiene la fecha local YYYY-MM-DD (Igual a Pizzería main.js)
export const getLocalDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

// Formato bonito para mostrar en pantalla
export const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    // Si es Timestamp de Firestore
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};