const beijingFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

export function nowUtc(): Date {
  return new Date();
}

export function parseMaybeDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBeijingTime(value: Date | string | null | undefined): string {
  const parsed = parseMaybeDate(value);
  if (!parsed) {
    return '未知时间';
  }

  return `${beijingFormatter.format(parsed)} CST`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
