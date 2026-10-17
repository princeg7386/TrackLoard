import { randomUUID } from 'crypto';
import {
  IMessagingProvider,
  SendMessageOptions,
  MessageSendResult,
} from '@school-bus/shared';

export interface MockSentMessage extends SendMessageOptions {
  id: string;
  sentAt: string;
  provider: string;
}

/**
 * Mock WhatsApp & SMS Messaging Adapter.
 * Records all dispatched messages in memory for automated test verification and offline simulation.
 */
export class MockMessagingAdapter implements IMessagingProvider {
  public readonly providerName = 'MOCK_MESSAGING_PROVIDER';

  private static sentMessages: MockSentMessage[] = [];

  public async isHealthy(): Promise<boolean> {
    return true;
  }

  public async sendMessage(options: SendMessageOptions): Promise<MessageSendResult> {
    const id = `mock_msg_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const record: MockSentMessage = {
      id,
      sentAt: timestamp,
      provider: this.providerName,
      ...options,
    };

    MockMessagingAdapter.sentMessages.push(record);

    return {
      messageId: id,
      status: 'sent',
      provider: this.providerName,
      timestamp,
    };
  }

  public async sendLocationRequest(
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
    const defaultText = context?.studentName
      ? `Hello! Please share your live or current location to set or update ${context.studentName}'s bus pickup point.`
      : promptText;

    return this.sendMessage({
      recipientPhone,
      schoolId: context?.schoolId,
      studentId: context?.studentId,
      directText: promptText || defaultText,
      interactiveType: 'location_request_message',
      actionButtons: [
        {
          title: 'Send Location',
          payload: `LOCATION_PROMPT_${context?.studentId || 'GENERIC'}`,
        },
      ],
    });
  }

  public static getSentMessages(): MockSentMessage[] {
    return [...MockMessagingAdapter.sentMessages];
  }

  public static getSentMessagesForPhone(phone: string): MockSentMessage[] {
    const cleanPhone = phone.replace(/\D/g, '');
    return MockMessagingAdapter.sentMessages.filter(
      (m) => m.recipientPhone.replace(/\D/g, '').includes(cleanPhone) || cleanPhone.includes(m.recipientPhone.replace(/\D/g, ''))
    );
  }

  public static clear(): void {
    MockMessagingAdapter.sentMessages = [];
  }
}
