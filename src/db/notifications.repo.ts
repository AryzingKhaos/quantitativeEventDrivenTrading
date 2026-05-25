import type { Pool } from 'pg';

import type { NotificationStatus } from './schema.js';

interface NotificationRow {
  id: number;
  event_id: number;
  target: string;
  status: NotificationStatus;
  error_message: string | null;
  sent_at: Date | null;
  created_at: Date;
  telegram_message_id: number | string | null;
}

export class NotificationsRepository {
  constructor(private readonly pool: Pool) {}

  async hasDelivered(eventId: number, target: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM notifications
          WHERE event_id = $1
            AND target = $2
            AND status = 'success'
        ) AS exists
      `,
      [eventId, target]
    );

    return result.rows[0]?.exists ?? false;
  }

  async upsertDelivery(params: {
    eventId: number;
    target: string;
    status: NotificationStatus;
    errorMessage?: string | null;
    sentAt?: Date | null;
    telegramMessageId?: number | null;
  }): Promise<NotificationRow> {
    const result = await this.pool.query<NotificationRow>(
      `
        INSERT INTO notifications (
          event_id,
          target,
          status,
          error_message,
          sent_at,
          telegram_message_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id, target)
        DO UPDATE SET
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          sent_at = EXCLUDED.sent_at,
          telegram_message_id = COALESCE(EXCLUDED.telegram_message_id, notifications.telegram_message_id)
        RETURNING *
      `,
      [
        params.eventId,
        params.target,
        params.status,
        params.errorMessage ?? null,
        params.sentAt ?? null,
        params.telegramMessageId ?? null
      ]
    );

    return result.rows[0];
  }
}
