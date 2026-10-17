import {
  DriverWhatsAppAction,
  DriverWhatsAppMenuItem,
  DriverWhatsAppMenuResponse,
  DriverWhatsAppInboundRequest,
  DriverWhatsAppInboundResponse,
  TripStatus,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';

export class DriverWhatsappService {
  /**
   * Normalizes Indian phone numbers into consistent international format (+91...)
   * Handles variations: 9876543210, 09876543210, 919876543210, +919876543210
   */
  public static normalizeIndianPhone(rawPhone: string): {
    international: string;
    national10: string;
    variants: string[];
  } {
    const digits = rawPhone.replace(/\D/g, '');
    let national10 = digits;

    if (digits.length === 10) {
      national10 = digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      national10 = digits.substring(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
      national10 = digits.substring(2);
    } else if (digits.length > 10) {
      national10 = digits.slice(-10);
    }

    const international = `+91${national10}`;
    const variants = [
      international,
      `91${national10}`,
      national10,
      `0${national10}`,
    ];

    return { international, national10, variants };
  }

  /**
   * Resolves driver record and attached default bus by phone number
   */
  public static async findDriverByPhone(
    phone: string,
    schoolId?: string
  ): Promise<{
    id: string;
    schoolId: string;
    fullName: string;
    phone: string;
    licenseNumber: string;
    busId?: string;
    busNumber?: string;
    registrationNumber?: string;
  } | null> {
    const { variants, national10 } = this.normalizeIndianPhone(phone);

    const rows = await query<{
      id: string;
      school_id: string;
      full_name: string;
      phone: string;
      license_number: string;
      bus_id: string | null;
      bus_number: string | null;
      registration_number: string | null;
    }>(
      `SELECT d.id, d.school_id, d.full_name, d.phone, d.license_number,
              b.id AS bus_id, b.bus_number, b.registration_number
       FROM drivers d
       LEFT JOIN buses b ON b.default_driver_id = d.id AND b.deleted_at IS NULL
       WHERE (
         d.phone = $1 OR d.phone = $2 OR d.phone = $3 OR d.phone = $4
         OR RIGHT(d.phone, 10) = $5
       )
       AND ($6::uuid IS NULL OR d.school_id = $6::uuid)
       AND d.deleted_at IS NULL
       LIMIT 1`,
      [variants[0], variants[1], variants[2], variants[3], national10, schoolId || null]
    );

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const r = rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      fullName: r.full_name,
      phone: r.phone,
      licenseNumber: r.license_number,
      busId: r.bus_id || undefined,
      busNumber: r.bus_number || undefined,
      registrationNumber: r.registration_number || undefined,
    };
  }

  /**
   * Resolves active or today's scheduled trip for the driver
   */
  public static async getDriverTripContext(
    driverId: string,
    schoolId: string
  ): Promise<{
    activeTrip?: {
      id: string;
      routeId: string;
      routeName?: string;
      routeCode?: string;
      status: TripStatus;
      currentStopSequence: number;
      totalStops: number;
      busNumber?: string;
    } | null;
    scheduledTrip?: {
      id: string;
      routeId: string;
      routeName?: string;
      routeCode?: string;
      scheduledStartTime: string;
      busNumber?: string;
    } | null;
  }> {
    // 1. Check for trip in active transit (IN_TRANSIT or DELAYED)
    const activeRows = await query<{
      id: string;
      route_id: string;
      status: TripStatus;
      current_stop_sequence: number;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
      total_stops: number;
    }>(
      `SELECT t.id, t.route_id, t.status, t.current_stop_sequence,
              r.name AS route_name, r.code AS route_code,
              b.bus_number,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = t.route_id AND pl.deleted_at IS NULL) AS total_stops
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.driver_id = $1 AND t.school_id = $2
         AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED')
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [driverId, schoolId]
    );

    if (activeRows.length > 0 && activeRows[0]) {
      const a = activeRows[0];
      return {
        activeTrip: {
          id: a.id,
          routeId: a.route_id,
          routeName: a.route_name || undefined,
          routeCode: a.route_code || undefined,
          status: a.status,
          currentStopSequence: Number(a.current_stop_sequence),
          totalStops: Number(a.total_stops),
          busNumber: a.bus_number || undefined,
        },
        scheduledTrip: null,
      };
    }

    // 2. Check for today's scheduled trip
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const scheduledRows = await query<{
      id: string;
      route_id: string;
      scheduled_start_time: string;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
    }>(
      `SELECT t.id, t.route_id, t.scheduled_start_time::text AS scheduled_start_time,
              r.name AS route_name, r.code AS route_code,
              b.bus_number
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.driver_id = $1 AND t.school_id = $2
         AND t.status = 'SCHEDULED'
         AND t.scheduled_date = $3::date
         AND t.deleted_at IS NULL
       ORDER BY t.scheduled_start_time ASC
       LIMIT 1`,
      [driverId, schoolId, todayDate]
    );

    if (scheduledRows.length > 0 && scheduledRows[0]) {
      const s = scheduledRows[0];
      return {
        activeTrip: null,
        scheduledTrip: {
          id: s.id,
          routeId: s.route_id,
          routeName: s.route_name || undefined,
          routeCode: s.route_code || undefined,
          scheduledStartTime: s.scheduled_start_time,
          busNumber: s.bus_number || undefined,
        },
      };
    }

    return { activeTrip: null, scheduledTrip: null };
  }

  /**
   * Generates standard Driver WhatsApp menu items (Micro-phase 17.1 tasks)
   */
  public static getStandardMenuItems(): DriverWhatsAppMenuItem[] {
    return [
      {
        action: DriverWhatsAppAction.START_TRIP,
        title: 'Start Trip',
        description: 'Begin departure for today’s assigned bus route',
        commandCode: '1',
      },
      {
        action: DriverWhatsAppAction.END_TRIP,
        title: 'End Trip',
        description: 'Conclude current trip and lock attendance ledger',
        commandCode: '2',
      },
      {
        action: DriverWhatsAppAction.STUDENT_SEARCH,
        title: 'Student Search',
        description: 'Look up student pickup stop and guardian contact',
        commandCode: '3',
      },
      {
        action: DriverWhatsAppAction.REPORT_PROBLEM,
        title: 'Report Problem',
        description: 'Report traffic delay, mechanical issue or breakdown',
        commandCode: '4',
      },
      {
        action: DriverWhatsAppAction.EMERGENCY,
        title: 'Emergency',
        description: 'Send immediate SOS distress alert to school coordinators',
        commandCode: '5',
      },
      {
        action: DriverWhatsAppAction.HELP,
        title: 'Help',
        description: 'View instructions and school transport control room helpline',
        commandCode: '6',
      },
    ];
  }

  /**
   * Generates formatted WhatsApp text message for the driver menu
   */
  public static formatDriverMenuText(params: {
    driverName: string;
    busNumber?: string;
    registrationNumber?: string;
    activeTrip?: {
      routeName?: string;
      routeCode?: string;
      currentStopSequence: number;
      totalStops: number;
    } | null;
    scheduledTrip?: {
      routeName?: string;
      routeCode?: string;
      scheduledStartTime: string;
    } | null;
  }): string {
    const { driverName, busNumber, registrationNumber, activeTrip, scheduledTrip } = params;

    let vehicleText = 'Assigned Bus: Not Assigned';
    if (busNumber && registrationNumber) {
      vehicleText = `Assigned Bus: *${busNumber}* (${registrationNumber})`;
    } else if (busNumber) {
      vehicleText = `Assigned Bus: *${busNumber}*`;
    }

    let statusSection = 'Operational Status: *Idle / Off Duty*';
    if (activeTrip) {
      const routeInfo = activeTrip.routeCode
        ? `${activeTrip.routeCode} - ${activeTrip.routeName || 'Active Route'}`
        : activeTrip.routeName || 'Active Route';
      statusSection = `Operational Status: *In Transit* 🟢\nActive Route: *${routeInfo}*\nStop Progress: *${activeTrip.currentStopSequence} / ${activeTrip.totalStops}*`;
    } else if (scheduledTrip) {
      const routeInfo = scheduledTrip.routeCode
        ? `${scheduledTrip.routeCode} - ${scheduledTrip.routeName || 'Scheduled Route'}`
        : scheduledTrip.routeName || 'Scheduled Route';
      statusSection = `Operational Status: *Scheduled for Today* 🟡\nRoute: *${routeInfo}*\nDeparture: *${scheduledTrip.scheduledStartTime.substring(11, 16) || scheduledTrip.scheduledStartTime}*`;
    }

    return (
      `🚌 *School Bus Driver Menu*\n` +
      `Namaste, *${driverName}*!\n\n` +
      `${vehicleText}\n` +
      `${statusSection}\n\n` +
      `Reply with a number or command:\n` +
      `1️⃣ *Start Trip* — Begin trip departure\n` +
      `2️⃣ *End Trip* — Complete trip & lock attendance\n` +
      `3️⃣ *Student Search* — Find student & stop info\n` +
      `4️⃣ *Report Problem* — Report delay, traffic, or issue\n` +
      `5️⃣ *Emergency* — Send SOS emergency alert\n` +
      `6️⃣ *Help* — Support & emergency helpline\n\n` +
      `_Type any number (1-6) or action keyword anytime._`
    );
  }

  /**
   * Retrieves complete Driver WhatsApp Menu by phone or driver ID
   */
  public static async getDriverMenu(
    phoneOrIdOrDriver:
      | string
      | {
          id: string;
          schoolId: string;
          fullName: string;
          phone: string;
          licenseNumber?: string;
          busId?: string;
          busNumber?: string;
          registrationNumber?: string;
        },
    schoolId?: string
  ): Promise<DriverWhatsAppMenuResponse | null> {
    let driver: {
      id: string;
      schoolId: string;
      fullName: string;
      phone: string;
      licenseNumber?: string;
      busId?: string;
      busNumber?: string;
      registrationNumber?: string;
    } | null = null;

    if (typeof phoneOrIdOrDriver === 'object' && phoneOrIdOrDriver !== null) {
      driver = phoneOrIdOrDriver;
    } else {
      const phoneOrId = phoneOrIdOrDriver;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phoneOrId);

      if (isUuid) {
        const rows = await query<{
          id: string;
          school_id: string;
          full_name: string;
          phone: string;
          license_number: string;
          bus_id: string | null;
          bus_number: string | null;
          registration_number: string | null;
        }>(
          `SELECT d.id, d.school_id, d.full_name, d.phone, d.license_number,
                  b.id AS bus_id, b.bus_number, b.registration_number
           FROM drivers d
           LEFT JOIN buses b ON b.default_driver_id = d.id AND b.deleted_at IS NULL
           WHERE d.id = $1 AND ($2::uuid IS NULL OR d.school_id = $2::uuid) AND d.deleted_at IS NULL
           LIMIT 1`,
          [phoneOrId, schoolId || null]
        );
        if (rows.length > 0 && rows[0]) {
          const r = rows[0];
          driver = {
            id: r.id,
            schoolId: r.school_id,
            fullName: r.full_name,
            phone: r.phone,
            licenseNumber: r.license_number,
            busId: r.bus_id || undefined,
            busNumber: r.bus_number || undefined,
            registrationNumber: r.registration_number || undefined,
          };
        }
      } else {
        driver = await this.findDriverByPhone(phoneOrId, schoolId);
      }
    }

    if (!driver) {
      return null;
    }

    const tripContext = await this.getDriverTripContext(driver.id, driver.schoolId);
    const menuItems = this.getStandardMenuItems();
    const formattedText = this.formatDriverMenuText({
      driverName: driver.fullName,
      busNumber: driver.busNumber,
      registrationNumber: driver.registrationNumber,
      activeTrip: tripContext.activeTrip,
      scheduledTrip: tripContext.scheduledTrip,
    });

    return {
      driver: {
        id: driver.id,
        fullName: driver.fullName,
        phone: driver.phone,
        schoolId: driver.schoolId,
      },
      bus: driver.busId
        ? {
            id: driver.busId,
            busNumber: driver.busNumber || '',
            registrationNumber: driver.registrationNumber || '',
          }
        : undefined,
      activeTrip: tripContext.activeTrip || null,
      scheduledTrip: tripContext.scheduledTrip || null,
      menuItems,
      formattedText,
    };
  }

  /**
   * Resolves inbound message text to a specific DriverWhatsAppAction
   */
  public static parseActionFromInput(text?: string, action?: DriverWhatsAppAction): DriverWhatsAppAction | 'MENU' {
    if (action && Object.values(DriverWhatsAppAction).includes(action)) {
      return action;
    }

    if (!text) {
      return 'MENU';
    }

    const clean = text.trim().toLowerCase();

    // 1. Start Trip
    if (
      clean === '1' ||
      clean === 'start' ||
      clean === 'start trip' ||
      clean === 'trip start' ||
      clean.includes('start trip') ||
      clean === 'driver_action_start_trip'
    ) {
      return DriverWhatsAppAction.START_TRIP;
    }

    // 2. End Trip
    if (
      clean === '2' ||
      clean === 'end' ||
      clean === 'end trip' ||
      clean === 'complete' ||
      clean === 'finish' ||
      clean.includes('end trip') ||
      clean === 'driver_action_end_trip'
    ) {
      return DriverWhatsAppAction.END_TRIP;
    }

    // 3. Student Search
    if (
      clean === '3' ||
      clean === 'search' ||
      clean === 'student' ||
      clean === 'student search' ||
      clean.startsWith('search ') ||
      clean === 'driver_action_student_search'
    ) {
      return DriverWhatsAppAction.STUDENT_SEARCH;
    }

    // 4. Report Problem
    if (
      clean === '4' ||
      clean === 'problem' ||
      clean === 'issue' ||
      clean === 'delay' ||
      clean === 'traffic' ||
      clean === 'breakdown' ||
      clean === 'report problem' ||
      clean === 'driver_action_report_problem'
    ) {
      return DriverWhatsAppAction.REPORT_PROBLEM;
    }

    // 5. Emergency / SOS
    if (
      clean === '5' ||
      clean === 'emergency' ||
      clean === 'sos' ||
      clean === 'accident' ||
      clean === 'danger' ||
      clean === 'driver_action_emergency'
    ) {
      return DriverWhatsAppAction.EMERGENCY;
    }

    // 6. Help / Menu
    if (
      clean === '6' ||
      clean === 'help' ||
      clean === 'menu' ||
      clean === 'hi' ||
      clean === 'hello' ||
      clean === 'namaste' ||
      clean === 'start' ||
      clean === 'driver_action_help'
    ) {
      return DriverWhatsAppAction.HELP;
    }

    return 'MENU';
  }

  /**
   * Processes inbound driver WhatsApp message, executes menu workflow, and responds via WhatsApp
   */
  public static async handleInboundMessage(
    payload: DriverWhatsAppInboundRequest
  ): Promise<DriverWhatsAppInboundResponse> {
    const { from, text, action, schoolId } = payload;
    const { international } = this.normalizeIndianPhone(from);

    logger.info(`[DriverWhatsApp] Received message from ${from}: "${text || ''}" (action: ${action || 'none'})`);

    // 1. Identify driver by phone number
    const driver = await this.findDriverByPhone(from, schoolId);

    if (!driver) {
      const unregisteredReply =
        `⚠️ *Unregistered Mobile Number*\n\n` +
        `Your phone number (*${international}*) is not registered as an active bus driver in our school transport safety platform.\n\n` +
        `Please contact your School Transport Coordinator to register your mobile number before accessing driver operations.`;

      await MessagingService.sendMessage({
        recipientPhone: international,
        recipientRole: 'DRIVER',
        directText: unregisteredReply,
        schoolId: schoolId,
      });

      return {
        handled: false,
        actionTriggered: 'UNREGISTERED',
        replyText: unregisteredReply,
      };
    }

    // 2. Fetch driver menu and current operational context
    const menu = await this.getDriverMenu(driver, driver.schoolId);
    if (!menu) {
      throw new Error(`Failed to load driver menu for driver ${driver.id}`);
    }

    const resolvedAction = this.parseActionFromInput(text, action);
    let replyText = '';

    switch (resolvedAction) {
      case DriverWhatsAppAction.START_TRIP: {
        if (menu.activeTrip) {
          replyText =
            `🟢 *Trip Already In Transit*\n\n` +
            `You are currently driving Route *${menu.activeTrip.routeCode || menu.activeTrip.routeName || 'Active Route'}*.\n` +
            `Current stop sequence: *Stop #${menu.activeTrip.currentStopSequence} of ${menu.activeTrip.totalStops}*.\n\n` +
            `Reply *2* to End Trip when arrived at school, or *3* to search student details.`;
        } else if (menu.scheduledTrip) {
          const departure = menu.scheduledTrip.scheduledStartTime.substring(11, 16) || menu.scheduledTrip.scheduledStartTime;
          replyText =
            `🚀 *Ready to Start Today’s Trip*\n\n` +
            `Route: *${menu.scheduledTrip.routeCode || menu.scheduledTrip.routeName || 'Assigned Route'}*\n` +
            `Bus: *${menu.bus?.busNumber || 'Assigned Bus'}*\n` +
            `Scheduled Departure: *${departure}*\n\n` +
            `To start live parent tracking and departure, please use your Driver App or confirm via coordination desk.`;
        } else {
          replyText =
            `ℹ️ *No Scheduled Trip Found*\n\n` +
            `You have no trips scheduled for today. Please contact your transport coordinator to assign your daily route.`;
        }
        break;
      }

      case DriverWhatsAppAction.END_TRIP: {
        if (menu.activeTrip) {
          replyText =
            `🏁 *End Trip Confirmation*\n\n` +
            `Route: *${menu.activeTrip.routeCode || menu.activeTrip.routeName || 'Active Route'}*\n` +
            `Completed Stops: *${menu.activeTrip.currentStopSequence} / ${menu.activeTrip.totalStops}*\n\n` +
            `To finalize trip completion and lock attendance records, tap 'Complete Trip' in your Driver App or contact transport desk.`;
        } else {
          replyText =
            `ℹ️ *No Active Trip in Transit*\n\n` +
            `You do not currently have an active trip to complete. Reply *1* to view today’s scheduled trip.`;
        }
        break;
      }

      case DriverWhatsAppAction.STUDENT_SEARCH: {
        replyText =
          `🔍 *Student Search*\n\n` +
          `Reply with the student's name or admission number to verify pickup/drop stop and parent emergency phone.\n\n` +
          `_Example: "Search Aarav" or "Student 1042"_`;
        break;
      }

      case DriverWhatsAppAction.REPORT_PROBLEM: {
        replyText =
          `⚠️ *Report Operational Problem*\n\n` +
          `Please reply with your issue code:\n` +
          `• *TRAFFIC* <minutes> (e.g., Traffic 15 mins)\n` +
          `• *BREAKDOWN* (mechanical issue)\n` +
          `• *ROAD BLOCKED* (route deviation required)\n\n` +
          `The transport coordinator desk will be alerted immediately.`;
        break;
      }

      case DriverWhatsAppAction.EMERGENCY: {
        replyText =
          `🚨 *EMERGENCY / SOS DISPATCH*\n\n` +
          `If in immediate life-threatening danger, dial *112* immediately!\n\n` +
          `To trigger a priority SOS alert to the school management and transport coordinator, reply *CONFIRM SOS*.\n` +
          `Emergency Control Desk: *+91 1800 123 4567*`;
        break;
      }

      case DriverWhatsAppAction.HELP:
      case 'MENU':
      default: {
        replyText = menu.formattedText;
        break;
      }
    }

    // 3. Dispatch reply to driver via WhatsApp
    await MessagingService.sendMessage({
      recipientPhone: international,
      recipientRole: 'DRIVER',
      schoolId: driver.schoolId,
      directText: replyText,
      interactiveType: 'list',
      actionButtons: [
        { title: 'Start Trip', payload: 'DRIVER_ACTION_START_TRIP' },
        { title: 'End Trip', payload: 'DRIVER_ACTION_END_TRIP' },
        { title: 'Emergency', payload: 'DRIVER_ACTION_EMERGENCY' },
      ],
    });

    return {
      handled: true,
      driverId: driver.id,
      schoolId: driver.schoolId,
      actionTriggered: resolvedAction,
      replyText,
      menu,
    };
  }

  /**
   * Inbound WhatsApp Cloud API / Webhook payload processor
   */
  public static async handleWebhookPayload(body: any): Promise<DriverWhatsAppInboundResponse | { handled: boolean }> {
    // 1. WhatsApp Cloud API message format: entry[].changes[].value.messages[]
    const message =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
      (body?.from && (body?.text || body?.action || body?.button) ? body : null);

    if (!message) {
      return { handled: false };
    }

    const from = message.from;
    let text = message.text?.body || message.text || '';

    // Handle interactive button replies from Meta Cloud API
    if (message.type === 'interactive' && message.interactive) {
      if (message.interactive.button_reply) {
        text = message.interactive.button_reply.id || message.interactive.button_reply.title || text;
      } else if (message.interactive.list_reply) {
        text = message.interactive.list_reply.id || message.interactive.list_reply.title || text;
      }
    } else if (message.type === 'button' && message.button) {
      text = message.button.payload || message.button.text || text;
    }

    if (!from) {
      return { handled: false };
    }

    return this.handleInboundMessage({
      from,
      text,
    });
  }
}
