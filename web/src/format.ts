export function formatTime(value?: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function formatMoney(value: unknown, currency = 'CNY') {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Number.isFinite(number) ? number : 0);
}

export function countItems(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export function labelFromSnake(value: string) {
  return value.replace(/_/g, ' ');
}
