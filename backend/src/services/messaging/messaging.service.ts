import {
  IMessagingProvider,
  SendMessageOptions,
  MessageSendResult,
} from '@school-bus/shared';
import { MockMessagingAdapter } from './mock-messaging.adapter.js';
import { MetaCloudWhatsAppAdapter } from './meta-cloud-whatsapp.adapter.js';
import { query } from '../../config/database.js';
import { env } from '../../config/env.js';

/**
 * Domain Service for WhatsApp & SMS Outbound Communication.
 * Provider-agnostic interface with audit logging in PostgreSQL notifications table.
 */
export class MessagingService {
  private static provider: IMessagingProvider =
    process.env.NODE_ENV === 'test' || env.MESSAGING_PROVIDER === 'mock'
      ? new MockMessagingAdapter()
      : new MetaCloudWhatsAppAdapter();

  public static setProvider(newProvider: IMessagingProvider): void {
    MessagingService.provider = newProvider;
  }

  public static getProvider(): IMessagingProvider {
    return MessagingService.provider;
  }

  public static resetProvider(): void {
    MockMessagingAdapter.clear();
    MessagingService.provider =
      process.env.NODE_ENV === 'test' || env.MESSAGING_PROVIDER === 'mock'
        ? new MockMessagingAdapter()
        : new MetaCloudWhatsAppAdapter();
  }

  public static async isHealthy(): Promise<boolean> {
    return MessagingService.provider.isHealthy();
  }

  /**
   * Dispatch an outbound message (WhatsApp/SMS) and record in notifications audit table
   */
  public static async sendMessage(options: SendMessageOptions): Promise<MessageSendResult> {
    const result = await MessagingService.provider.sendMessage(options);

    // Asynchronously log to PostgreSQL notifications table if schoolId is provided
    if (options.schoolId) {
      try {
        await query(
          `INSERT INTO notifications (
             school_id, recipient_phone, recipient_role, channel,
             template_name, message_body, status, provider_message_id
           ) VALUES ($1, $2, $3, 'WHATSAPP', $4, $5, $6, $7)`,
          [
            options.schoolId,
            options.recipientPhone,
            options.recipientRole || 'PARENT',
            options.templateId || options.interactiveType || 'DIRECT_TEXT',
            options.directText || 'WhatsApp notification',
            result.status.toUpperCase(),
            result.messageId,
          ]
        );
      } catch {
        // Notification table insert failure should not fail outbound dispatch
      }
    }

    return result;
  }

  /**
   * Send WhatsApp interactive Location Request prompt
   */
  public static async sendLocationRequest(
    recipientPhone: string,
    promptText: string,
    context?: {
      schoolId?: string;
      studentId?: string;
      parentName?: string;
      studentName?: string;
      schoolName?: string;
    }
  ): Promise<MessageSendResult> {
    const result = await MessagingService.provider.sendLocationRequest(
      recipientPhone,
      promptText,
      context
    );

    if (context?.schoolId) {
      try {
        await query(
          `INSERT INTO notifications (
             school_id, recipient_phone, recipient_role, channel,
             template_name, message_body, status, provider_message_id
           ) VALUES ($1, $2, 'PARENT', 'WHATSAPP', 'LOCATION_REQUEST', $3, $4, $5)`,
          [
            context.schoolId,
            recipientPhone,
            promptText,
            result.status.toUpperCase(),
            result.messageId,
          ]
        );
      } catch {
        // Safe ignore
      }
    }

    return result;
  }
}
