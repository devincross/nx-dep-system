import { reactive } from 'vue';

type NotifyColor = 'success' | 'error' | 'info';

// Shared state rendered once by App.vue so any view can report an outcome
export const notification = reactive({ show: false, message: '', color: 'success' as NotifyColor });

function notify(message: string, color: NotifyColor) {
  notification.message = message;
  notification.color = color;
  notification.show = true;
}

/** Best message for a failed API call, falling back to `fallback`. */
export function errorMessage(err: any, fallback: string): string {
  const msg = err?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

export function useNotify() {
  return {
    success: (message: string) => notify(message, 'success'),
    info: (message: string) => notify(message, 'info'),
    error: (message: string) => notify(message, 'error'),
    errorFrom: (err: any, fallback: string) => notify(errorMessage(err, fallback), 'error'),
  };
}
