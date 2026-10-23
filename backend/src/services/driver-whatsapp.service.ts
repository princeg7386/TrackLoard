import {
  DriverWhatsAppAction,
  DriverWhatsAppMenuItem,
  DriverWhatsAppMenuResponse,
  DriverWhatsAppInboundRequest,
  DriverWhatsAppInboundResponse,
  DriverWhatsAppStartTripRequest,
  DriverWhatsAppStartTripResponse,
  DriverWhatsAppEndTripRequest,
  DriverWhatsAppEndTripResponse,
  TripStatus,
  RecordBoardingResponse,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';
import { TripService } from './trip.service.js';
import { ParentIdentityService } from './parent-identity.service.js';
import { DriverAttendanceService } from './driver-attendance.service.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';

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
         AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
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

  private static recentCommands = new Map<
    string,
    { timestamp: number; response: DriverWhatsAppInboundResponse }
  >();

  public static clearCommandCache(): void {
    this.recentCommands.clear();
  }

  private static checkDuplicateCommand(
    driverId: string,
    actionKey: string
  ): DriverWhatsAppInboundResponse | null {
    const key = `${driverId}:${actionKey.trim().toLowerCase()}`;
    const now = Date.now();
    const existing = this.recentCommands.get(key);
    if (existing && now - existing.timestamp < 2500) {
      return {
        ...existing.response,
        actionTriggered: 'DUPLICATE_COMMAND',
        errorCode: 'DUPLICATE_COMMAND',
        replyText:
          `⏳ *Duplicate Request Received*\n\n` +
          `Your previous request was just received and processed. Please wait a moment before sending another request.\n\n` +
          `Reply *menu* to view your current trip status.`,
      };
    }
    return null;
  }

  private static recordCommandResponse(
    driverId: string,
    actionKey: string,
    response: DriverWhatsAppInboundResponse
  ): void {
    const key = `${driverId}:${actionKey.trim().toLowerCase()}`;
    this.recentCommands.set(key, {
      timestamp: Date.now(),
      response,
    });
    if (this.recentCommands.size > 1000) {
      const cutoff = Date.now() - 10000;
      for (const [k, v] of this.recentCommands.entries()) {
        if (v.timestamp < cutoff) {
          this.recentCommands.delete(k);
        }
      }
    }
  }

  /**
   * Resolves inbound message text to a specific DriverWhatsAppAction
   */
  public static parseActionFromInput(
    text?: string,
    action?: DriverWhatsAppAction
  ): DriverWhatsAppAction | 'MENU' | 'UNKNOWN_COMMAND' {
    if (action && Object.values(DriverWhatsAppAction).includes(action)) {
      return action;
    }

    if (!text || !text.trim()) {
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

    // 2b. Arrive at School Campus
    if (
      clean === 'arrive' ||
      clean === 'arrived' ||
      clean === 'reach' ||
      clean === 'reached' ||
      clean === 'arrive school' ||
      clean === 'arrived school' ||
      clean === 'reach school' ||
      clean === 'reached school' ||
      clean === 'school arrived' ||
      clean === 'driver_action_arrive_school'
    ) {
      return 'ARRIVE_SCHOOL' as any;
    }

    // 2c. Student Boarding Attendance (Micro-phase 18.2)
    if (
      clean.startsWith('board ') ||
      clean.startsWith('boarded ') ||
      clean.startsWith('b ')
    ) {
      return 'BOARD_STUDENT' as any;
    }

    if (
      clean.startsWith('absent ') ||
      clean.startsWith('not boarded ') ||
      clean.startsWith('ab ')
    ) {
      return 'ABSENT_STUDENT' as any;
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
      clean === 'support' ||
      clean === 'info' ||
      clean === 'driver_action_help'
    ) {
      return DriverWhatsAppAction.HELP;
    }

    return 'UNKNOWN_COMMAND';
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

      let whatsappDelivered = true;
      let errorCode: string | undefined;
      try {
        await MessagingService.sendMessage({
          recipientPhone: international,
          recipientRole: 'DRIVER',
          directText: unregisteredReply,
          schoolId: schoolId,
        });
      } catch (err: any) {
        logger.warn(`[DriverWhatsApp] Outbound WhatsApp dispatch failed for unregistered driver: ${err.message}`);
        whatsappDelivered = false;
        errorCode = 'TEMPORARY_WHATSAPP_FAILURE';
      }

      return {
        handled: false,
        actionTriggered: 'UNREGISTERED',
        replyText: unregisteredReply,
        whatsappDelivered,
        errorCode,
      };
    }

    const resolvedAction = this.parseActionFromInput(text, action);
    const commandKey = `${resolvedAction}:${(text || '').trim().toLowerCase()}`;

    // Rapid-submission deduplication check
    if (resolvedAction !== 'UNKNOWN_COMMAND') {
      const duplicate = this.checkDuplicateCommand(driver.id, commandKey);
      if (duplicate) {
        try {
          await MessagingService.sendMessage({
            recipientPhone: international,
            recipientRole: 'DRIVER',
            schoolId: driver.schoolId,
            directText: duplicate.replyText,
          });
        } catch {
          // Non-crashing dispatch failure
        }
        return duplicate;
      }
    }

    // 2. Fetch driver menu and current operational context
    const menu = await this.getDriverMenu(driver, driver.schoolId);
    if (!menu) {
      throw new Error(`Failed to load driver menu for driver ${driver.id}`);
    }

    let replyText = '';
    let errorCode: string | undefined;

    switch (resolvedAction) {
      case DriverWhatsAppAction.START_TRIP: {
        try {
          const startResult = await this.startTripViaWhatsApp({
            from,
            schoolId: driver.schoolId,
          });
          replyText = startResult.replyText;
        } catch (err: any) {
          if (
            err.details?.errorCode === 'NO_ASSIGNED_BUS' ||
            (err.message && err.message.toLowerCase().includes('no assigned bus'))
          ) {
            errorCode = 'NO_ASSIGNED_BUS';
            replyText =
              `⚠️ *No Assigned Bus Found*\n\n` +
              `You do not have a bus assigned to your driver profile or route.\n\n` +
              `Please contact your School Transport Coordinator to assign a bus before starting your trip.`;
          } else {
            errorCode = err.details?.errorCode || 'START_TRIP_FAILED';
            replyText =
              `⚠️ *Could Not Start Trip*\n\n` +
              `${err.message || 'Unable to start trip departure at this moment.'}\n\n` +
              `Please contact your School Transport Coordinator for assistance.`;
          }
        }
        break;
      }

      case DriverWhatsAppAction.END_TRIP: {
        try {
          const endResult = await this.endTripViaWhatsApp({
            from,
            schoolId: driver.schoolId,
          });
          replyText = endResult.replyText;
        } catch (err: any) {
          if (
            err.details?.errorCode === 'NO_ACTIVE_TRIP' ||
            (err.message && err.message.toLowerCase().includes('active trip'))
          ) {
            errorCode = 'NO_ACTIVE_TRIP';
            replyText =
              `⚠️ *No Active Trip Found*\n\n` +
              `You do not currently have an active trip in transit to complete.\n\n` +
              `Reply *1* to start today's scheduled trip or *menu* to view your options.`;
          } else {
            errorCode = err.details?.errorCode || 'END_TRIP_FAILED';
            replyText =
              `ℹ️ *Could Not End Trip*\n\n` +
              `${err.message || 'Unable to conclude trip at this moment.'}\n\n` +
              `Reply *menu* to view your current status and options.`;
          }
        }
        break;
      }

      case 'ARRIVE_SCHOOL' as any: {
        try {
          const arriveResult = await this.arriveAtSchoolViaWhatsApp({
            from,
            schoolId: driver.schoolId,
          });
          replyText = arriveResult.replyText;
        } catch (err: any) {
          errorCode = err.details?.errorCode || 'ARRIVE_SCHOOL_FAILED';
          replyText =
            `⚠️ *Could Not Mark Arrival*\n\n` +
            `${err.message || 'Unable to mark school arrival at this moment.'}\n\n` +
            `Reply *menu* to view your current status and options.`;
        }
        break;
      }

      case 'BOARD_STUDENT' as any: {
        const queryText = (text || '').replace(/^(board|boarded|b)\s+/i, '').trim();
        try {
          const boardResult = await this.recordBoardingViaWhatsApp({
            from,
            schoolId: driver.schoolId,
            queryText,
            status: 'BOARDED',
            driver,
          });
          replyText = boardResult.replyText;
        } catch (err: any) {
          replyText =
            `⚠️ *Could Not Mark Boarding*\n\n` +
            `${err.message || 'Unable to record boarding at this moment.'}\n\n` +
            `Reply *menu* to view your options.`;
        }
        break;
      }

      case 'ABSENT_STUDENT' as any: {
        const queryText = (text || '').replace(/^(absent|not boarded|ab)\s+/i, '').trim();
        try {
          const absentResult = await this.recordBoardingViaWhatsApp({
            from,
            schoolId: driver.schoolId,
            queryText,
            status: 'ABSENT',
            driver,
          });
          replyText = absentResult.replyText;
        } catch (err: any) {
          replyText =
            `⚠️ *Could Not Mark Absent*\n\n` +
            `${err.message || 'Unable to mark student absent at this moment.'}\n\n` +
            `Reply *menu* to view your options.`;
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
        const routeInfo = menu.activeTrip
          ? `Active Route: *${menu.activeTrip.routeName || 'Assigned Route'}*\n\n`
          : '';
        replyText =
          `⚠️ *Report Operational Problem*\n\n` +
          routeInfo +
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
      case 'MENU': {
        replyText = menu.formattedText;
        break;
      }

      case 'UNKNOWN_COMMAND':
      default: {
        errorCode = 'UNKNOWN_COMMAND';
        replyText =
          `❓ *Command Not Recognized*\n\n` +
          `We didn't recognize: "${text || ''}".\n\n` +
          `Please reply with a valid number (1-6) or command:\n` +
          `1️⃣ *Start Trip* — Begin trip departure\n` +
          `2️⃣ *End Trip* — Complete trip & lock attendance\n` +
          `3️⃣ *Student Search* — Find student & stop info\n` +
          `4️⃣ *Report Problem* — Report delay, traffic, or issue\n` +
          `5️⃣ *Emergency* — Send SOS emergency alert\n` +
          `6️⃣ *Help* — Support & emergency helpline\n\n` +
          `_Type any number (1-6) or reply *menu* anytime._`;
        break;
      }
    }

    // 3. Dispatch reply to driver via WhatsApp (with resilience against provider failures)
    let whatsappDelivered = true;
    try {
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
    } catch (dispatchErr: any) {
      logger.warn(`[DriverWhatsApp] Outbound WhatsApp dispatch failed for driver ${driver.id}: ${dispatchErr.message}`);
      whatsappDelivered = false;
      if (!errorCode) {
        errorCode = 'TEMPORARY_WHATSAPP_FAILURE';
      }
      try {
        await query(
          `INSERT INTO notifications (
             school_id, recipient_phone, recipient_role, channel,
             template_name, message_body, status, failure_reason
           ) VALUES ($1, $2, 'DRIVER', 'WHATSAPP', 'DIRECT_TEXT', $3, $4, $5)`,
          [
            driver.schoolId,
            international,
            replyText,
            'FAILED',
            dispatchErr.message || 'Temporary WhatsApp/API failure',
          ]
        );
      } catch {
        // Notification table insert failure should not throw
      }
    }

    const response: DriverWhatsAppInboundResponse = {
      handled: resolvedAction !== 'UNKNOWN_COMMAND',
      driverId: driver.id,
      schoolId: driver.schoolId,
      actionTriggered: resolvedAction,
      replyText,
      menu,
      whatsappDelivered,
      ...(errorCode ? { errorCode } : {}),
    };

    if (resolvedAction !== 'UNKNOWN_COMMAND') {
      this.recordCommandResponse(driver.id, commandKey, response);
    }

    return response;
  }

  /**
   * Micro-phase 17.2: Start Trip Flow via WhatsApp
   * 1. Identifies driver by phone number
   * 2. Identifies assigned bus
   * 3. Starts today's scheduled trip or auto-creates today's trip from assigned route
   * 4. Activates tracking session & links parent tracking tokens (via TripService.startTrip)
   * 5. Triggers parent departure notifications with secure tracking links
   * 6. Updates school dashboard via RealtimeFeedService
   */
  public static async startTripViaWhatsApp(params: {
    from: string;
    schoolId?: string;
    tripId?: string;
    routeId?: string;
    busId?: string;
  }): Promise<DriverWhatsAppStartTripResponse> {
    const { from, tripId: explicitTripId, routeId: explicitRouteId, busId: explicitBusId } = params;

    // 1. Identify driver by phone
    const driver = await this.findDriverByPhone(from, params.schoolId);
    if (!driver) {
      throw new NotFoundError(
        `Driver not registered with mobile number: ${from}`
      );
    }
    const schoolId = params.schoolId || driver.schoolId;

    // 2. Check for active trip in transit (Idempotency)
    const activeRows = await query<{
      id: string;
      route_id: string;
      bus_id: string;
      status: TripStatus;
      current_stop_sequence: number;
      actual_start_time: string | null;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
      registration_number: string | null;
      total_stops: number;
    }>(
      `SELECT t.id, t.route_id, t.bus_id, t.status, t.current_stop_sequence,
              t.actual_start_time::text AS actual_start_time,
              r.name AS route_name, r.code AS route_code,
              b.bus_number, b.registration_number,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = t.route_id AND pl.deleted_at IS NULL) AS total_stops
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.driver_id = $1 AND t.school_id = $2
         AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [driver.id, schoolId]
    );

    if (activeRows.length > 0 && activeRows[0]) {
      const active = activeRows[0];
      const tripDetail = await TripService.getTripById(schoolId, active.id, {
        userId: driver.id,
        isDriver: true,
        userRole: 'DRIVER',
      });

      const routeLabel = active.route_code
        ? `${active.route_code} - ${active.route_name || 'Active Route'}`
        : active.route_name || 'Active Route';

      const replyText =
        `🟢 *Trip Already In Transit*\n\n` +
        `You are currently driving Route *${routeLabel}* on Bus *${active.bus_number || 'Assigned Bus'}*.\n` +
        `Current Progress: *Stop #${active.current_stop_sequence} of ${active.total_stops}*.\n\n` +
        `Live GPS tracking session is active. Reply *2* to End Trip when arrived at school, or *3* to search student details.`;

      return {
        success: true,
        alreadyInTransit: true,
        trip: tripDetail,
        driver: {
          id: driver.id,
          fullName: driver.fullName,
          phone: driver.phone,
        },
        bus: {
          id: active.bus_id,
          busNumber: active.bus_number || '',
          registrationNumber: active.registration_number || '',
        },
        parentNotificationsSent: 0,
        trackingSessionActive: true,
        replyText,
      };
    }

    // 3. Resolve Target Bus
    let resolvedBus: { id: string; busNumber: string; registrationNumber: string } | null = null;
    if (explicitBusId) {
      const busRows = await query<{ id: string; bus_number: string; registration_number: string }>(
        `SELECT id, bus_number, registration_number FROM buses WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [explicitBusId, schoolId]
      );
      if (busRows.length > 0 && busRows[0]) {
        resolvedBus = {
          id: busRows[0].id,
          busNumber: busRows[0].bus_number,
          registrationNumber: busRows[0].registration_number,
        };
      }
    }

    if (!resolvedBus && driver.busId) {
      resolvedBus = {
        id: driver.busId,
        busNumber: driver.busNumber || '',
        registrationNumber: driver.registrationNumber || '',
      };
    }

    // 4. Resolve or Create Target Trip
    let targetTripId: string | null = explicitTripId || null;

    if (!targetTripId) {
      const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

      // Check today's scheduled trip for this driver
      const scheduledRows = await query<{ id: string; route_id: string; bus_id: string }>(
        `SELECT t.id, t.route_id, t.bus_id
         FROM trips t
         WHERE t.driver_id = $1 AND t.school_id = $2
           AND t.status = 'SCHEDULED'
           AND t.scheduled_date = $3::date
           AND t.deleted_at IS NULL
         ORDER BY t.scheduled_start_time ASC
         LIMIT 1`,
        [driver.id, schoolId, todayDate]
      );

      if (scheduledRows.length > 0 && scheduledRows[0]) {
        targetTripId = scheduledRows[0].id;
        if (!resolvedBus) {
          const sBusRows = await query<{ id: string; bus_number: string; registration_number: string }>(
            `SELECT id, bus_number, registration_number FROM buses WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
            [scheduledRows[0].bus_id, schoolId]
          );
          if (sBusRows.length > 0 && sBusRows[0]) {
            resolvedBus = {
              id: sBusRows[0].id,
              busNumber: sBusRows[0].bus_number,
              registrationNumber: sBusRows[0].registration_number,
            };
          }
        }
      }
    }

    // If still no trip found, look for assigned route to auto-create today's trip
    if (!targetTripId) {
      const routeRows = await query<{ id: string; name: string; code: string; default_bus_id: string | null }>(
        `SELECT r.id, r.name, r.code, r.default_bus_id
         FROM routes r
         WHERE (
           ($1::uuid IS NOT NULL AND r.id = $1::uuid)
           OR r.default_driver_id = $2
           OR ($3::uuid IS NOT NULL AND r.default_bus_id = $3::uuid)
         )
         AND r.school_id = $4
         AND r.deleted_at IS NULL
         ORDER BY r.created_at ASC
         LIMIT 1`,
        [explicitRouteId || null, driver.id, resolvedBus?.id || null, schoolId]
      );

      if (routeRows.length === 0 || !routeRows[0]) {
        throw new BadRequestError(
          'No scheduled trip or assigned route found for today. Please contact your transport coordinator.'
        );
      }

      const assignedRoute = routeRows[0];

      if (!resolvedBus) {
        const routeBusId = assignedRoute.default_bus_id;
        if (routeBusId) {
          const bRows = await query<{ id: string; bus_number: string; registration_number: string }>(
            `SELECT id, bus_number, registration_number FROM buses WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
            [routeBusId, schoolId]
          );
          if (bRows.length > 0 && bRows[0]) {
            resolvedBus = {
              id: bRows[0].id,
              busNumber: bRows[0].bus_number,
              registrationNumber: bRows[0].registration_number,
            };
          }
        }
      }

      if (!resolvedBus) {
        throw new BadRequestError(
          'No assigned bus found for this driver or route. Please assign a bus before starting the trip.',
          { errorCode: 'NO_ASSIGNED_BUS' }
        );
      }

      // Auto-create today's trip
      const createdTrip = await TripService.createTodayTrip(
        schoolId,
        {
          routeId: assignedRoute.id,
          busId: resolvedBus.id,
          driverId: driver.id,
        },
        {
          userId: driver.id,
          isDriver: true,
          userRole: 'DRIVER',
        }
      );
      targetTripId = createdTrip.id;
    }

    if (!resolvedBus) {
      throw new BadRequestError(
        'No assigned bus found for this driver. Please assign a bus before starting the trip.',
        { errorCode: 'NO_ASSIGNED_BUS' }
      );
    }

    // 5. Start Trip via TripService (activates GPS session & parent tokens, updates dashboard)
    const startedTrip = await TripService.startTrip(
      schoolId,
      targetTripId,
      {
        userId: driver.id,
        isDriver: true,
        userRole: 'DRIVER',
      }
    );

    // 6. Trigger Parent Notifications
    let parentNotifCount = 0;
    try {
      const parentRows = await query<{
        parent_id: string;
        parent_phone: string;
        parent_name: string;
        notifications_enabled: boolean | null;
        student_id: string;
        student_name: string;
        admission_number: string;
        stop_name: string | null;
      }>(
        `SELECT DISTINCT
           p.id AS parent_id,
           p.phone AS parent_phone,
           p.full_name AS parent_name,
           p.notifications_enabled,
           s.id AS student_id,
           s.full_name AS student_name,
           s.admission_number,
           pl.stop_name
         FROM student_stop_assignments ssa
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) AND pl.deleted_at IS NULL
         WHERE pl.route_id = $1
           AND ssa.school_id = $2
           AND ssa.deleted_at IS NULL`,
        [startedTrip.routeId, schoolId]
      );

      for (const p of parentRows) {
        if (!p.parent_phone || p.notifications_enabled === false) {
          continue;
        }

        try {
          const tokenData = await ParentIdentityService.createTrackingToken({
            parentId: p.parent_id,
            studentId: p.student_id,
            schoolId,
            tripId: startedTrip.id,
            purpose: 'TRIP_DEPARTURE',
            ttlHours: 24,
          });

          const routeNameDisplay = startedTrip.routeCode
            ? `${startedTrip.routeCode} - ${startedTrip.routeName || 'School Route'}`
            : startedTrip.routeName || 'School Route';

          const parentMsg =
            `🚌 *School Bus Departed — Live Tracking Active*\n\n` +
            `Namaste *${p.parent_name}*! Bus *${resolvedBus.busNumber}* has started Route *${routeNameDisplay}*.\n\n` +
            `Student: *${p.student_name}* (${p.admission_number})\n` +
            `Assigned Stop: *${p.stop_name || 'Designated Stop'}*\n\n` +
            `📍 Track live bus location and arrival time here:\n${tokenData.trackingUrl}\n\n` +
            `_Live updates are active. No native app download required._`;

          await MessagingService.sendMessage({
            recipientPhone: p.parent_phone,
            recipientRole: 'PARENT',
            schoolId,
            directText: parentMsg,
          });

          parentNotifCount++;
        } catch (err: any) {
          logger.warn(`[DriverWhatsApp] Failed to notify parent ${p.parent_phone}: ${err.message}`);
        }
      }
    } catch (err: any) {
      logger.error(`[DriverWhatsApp] Error querying parents for departure notifications: ${err.message}`);
    }

    const routeLabel = startedTrip.routeCode
      ? `${startedTrip.routeCode} - ${startedTrip.routeName || 'Assigned Route'}`
      : startedTrip.routeName || 'Assigned Route';

    const departureTime = startedTrip.actualStartTime
      ? new Date(startedTrip.actualStartTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
      : 'Now';

    const replyText =
      `🚀 *Trip Started Successfully!*\n\n` +
      `Route: *${routeLabel}*\n` +
      `Bus: *${resolvedBus.busNumber}* (${resolvedBus.registrationNumber})\n` +
      `Status: *In Transit* 🟢\n` +
      `Departure: *${departureTime}*\n` +
      `Notified Parents: *${parentNotifCount}*\n\n` +
      `Live GPS tracking session is active. School dashboard and parents have been updated.\n\n` +
      `Reply *2* to End Trip when arrived at school, or *3* to search student details.`;

    return {
      success: true,
      alreadyInTransit: false,
      trip: startedTrip,
      driver: {
        id: driver.id,
        fullName: driver.fullName,
        phone: driver.phone,
      },
      bus: resolvedBus,
      parentNotificationsSent: parentNotifCount,
      trackingSessionActive: true,
      replyText,
    };
  }

  /**
   * Arrive At School Flow via WhatsApp (Lifecycle: ARRIVED_SCHOOL)
   * 1. Identifies driver by phone number
   * 2. Finds active trip in transit
   * 3. Calls TripService.arriveAtSchool (updates status, audit log, triggers parent notification)
   * 4. Responds with arrival confirmation and prompt to End Trip when ready
   */
  public static async arriveAtSchoolViaWhatsApp(params: {
    from: string;
    schoolId?: string;
  }): Promise<{
    success: boolean;
    trip: any;
    replyText: string;
  }> {
    const { from, schoolId: overrideSchoolId } = params;
    const { international } = this.normalizeIndianPhone(from);

    const driver = await this.findDriverByPhone(from, overrideSchoolId);
    if (!driver) {
      throw new NotFoundError(`No driver registered for mobile ${international}`);
    }

    const schoolId = overrideSchoolId || driver.schoolId;

    const activeRows = await query<{
      id: string;
      bus_id: string;
      status: TripStatus;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
    }>(
      `SELECT t.id, t.bus_id, t.status,
              r.name AS route_name, r.code AS route_code,
              b.bus_number
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.driver_id = $1 AND t.school_id = $2
         AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [driver.id, schoolId]
    );

    if (activeRows.length === 0 || !activeRows[0]) {
      const error: any = new BadRequestError('No active trip currently in transit to mark arrived');
      error.details = { errorCode: 'NO_ACTIVE_TRIP' };
      throw error;
    }

    const active = activeRows[0];
    const trip = await TripService.arriveAtSchool(schoolId, active.id, {
      userId: driver.id,
      isDriver: true,
      userRole: 'DRIVER',
    });

    const routeLabel = active.route_code
      ? `${active.route_code} - ${active.route_name || 'Assigned Route'}`
      : active.route_name || 'Assigned Route';

    const replyText =
      `🏫 *Arrived at School Campus*\n\n` +
      `Trip on Route *${routeLabel}* (Bus *${active.bus_number || 'Assigned Bus'}*) has reached the destination school campus.\n\n` +
      `Students can now safely alight. Parents have been notified of your safe arrival.\n\n` +
      `Reply *2* to End Trip and finalize attendance.`;

    return {
      success: true,
      trip,
      replyText,
    };
  }

  /**
   * Micro-phase 18.2: Record Student Boarding Attendance via WhatsApp
   * Commands:
   *   "board <Name/AdmNo>"
   *   "absent <Name/AdmNo>"
   */
  public static async recordBoardingViaWhatsApp(params: {
    from: string;
    schoolId?: string;
    queryText: string;
    status: 'BOARDED' | 'ABSENT';
    driver?: any;
  }): Promise<{
    success: boolean;
    replyText: string;
    result?: RecordBoardingResponse;
  }> {
    const { from, queryText, status } = params;
    const driver = params.driver || (await this.findDriverByPhone(from, params.schoolId));

    if (!driver) {
      throw new NotFoundError('Driver phone number not registered in school transport directory');
    }

    const schoolId = driver.schoolId;

    if (!queryText || queryText.trim().length === 0) {
      const actionWord = status === 'BOARDED' ? 'board' : 'absent';
      return {
        success: false,
        replyText:
          `ℹ️ *Please provide a student name or admission number.*\n\n` +
          `_Example: "${actionWord} Aarav" or "${actionWord} 1042"_`,
      };
    }

    // 1. Find active trip for this driver
    const activeRows = await query<{
      id: string;
      bus_id: string;
      route_id: string;
      status: string;
    }>(
      `SELECT t.id, t.bus_id, t.route_id, t.status
       FROM trips t
       WHERE t.driver_id = $1 AND t.school_id = $2
         AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [driver.id, schoolId]
    );

    if (activeRows.length === 0 || !activeRows[0]) {
      return {
        success: false,
        replyText:
          `⚠️ *No Active Trip Found*\n\n` +
          `You do not have an active trip currently in progress to record boarding attendance.\n\n` +
          `Reply *1* to Start Trip before marking students.`,
      };
    }

    const activeTrip = activeRows[0];
    const cleanQuery = queryText.trim();

    // 2. Search for student on this trip's route or school
    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
      stop_id: string | null;
      stop_name: string | null;
    }>(
      `SELECT s.id, s.full_name, s.admission_number, pl.id AS stop_id, pl.stop_name
       FROM students s
       LEFT JOIN student_stop_assignments ssa ON ssa.student_id = s.id AND ssa.deleted_at IS NULL
       LEFT JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) AND pl.route_id = $2 AND pl.deleted_at IS NULL
       WHERE s.school_id = $1 AND s.deleted_at IS NULL
         AND (s.admission_number ILIKE $3 OR s.full_name ILIKE $4)
       ORDER BY (CASE WHEN pl.id IS NOT NULL THEN 0 ELSE 1 END), s.full_name ASC
       LIMIT 1`,
      [schoolId, activeTrip.route_id, cleanQuery, `%${cleanQuery}%`]
    );

    if (studentRows.length === 0 || !studentRows[0]) {
      return {
        success: false,
        replyText:
          `❌ *Student Not Found*\n\n` +
          `No student matching "${cleanQuery}" was found on your assigned route or school roster.\n\n` +
          `Please check the name or admission number and try again, or reply *3* to search the roster.`,
      };
    }

    const matchedStudent = studentRows[0];

    // 3. Record boarding via DriverAttendanceService
    const result = await DriverAttendanceService.recordBoarding(
      schoolId,
      {
        tripId: activeTrip.id,
        studentId: matchedStudent.id,
        stopId: matchedStudent.stop_id || undefined,
        status,
        recordedAt: new Date().toISOString(),
      },
      {
        userId: driver.id,
        isDriver: true,
        userRole: 'DRIVER',
        schoolId,
      }
    );

    const timeStr = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const isBoarded = status === 'BOARDED';
    const statusEmoji = isBoarded ? '✅' : '❌';
    const actionLabel = isBoarded ? 'Marked as BOARDED' : 'Marked as ABSENT / NOT BOARDED';

    const replyText =
      `${statusEmoji} *${matchedStudent.full_name}* ${actionLabel}\n\n` +
      `• Admission No: *${matchedStudent.admission_number}*\n` +
      `• Recorded At: *${timeStr}*\n` +
      (matchedStudent.stop_name ? `• Stop: *${matchedStudent.stop_name}*\n` : '') +
      `\n` +
      `📋 *Live Trip Attendance:*\n` +
      `• Boarded: *${result.summary.boardedCount} / ${result.summary.totalStudents}*\n` +
      `• Absent: *${result.summary.absentCount}*\n` +
      `• Pending: *${result.summary.pendingCount}*\n\n` +
      `Reply *board <Name>* or *absent <Name>* for next student.`;

    return {
      success: true,
      replyText,
      result,
    };
  }

  /**
   * Micro-phase 17.3: End Trip Flow via WhatsApp
   * 1. Identifies driver by phone number
   * 2. Identifies active trip in transit (or specified tripId)
   * 3. Concludes trip via TripService.completeTrip (stops tracking session, locks attendance)
   * 4. Retrieves comprehensive operational summary via TripService.getTripSummary
   * 5. Formats structured trip summary reply and notifies driver on WhatsApp
   */
  public static async endTripViaWhatsApp(params: {
    from: string;
    schoolId?: string;
    tripId?: string;
    summaryNotes?: string;
    endedAt?: string;
  }): Promise<DriverWhatsAppEndTripResponse> {
    const { from, tripId: explicitTripId, summaryNotes, endedAt } = params;

    // 1. Identify driver by phone
    const driver = await this.findDriverByPhone(from, params.schoolId);
    if (!driver) {
      throw new NotFoundError(`Driver not registered with mobile number: ${from}`);
    }
    const schoolId = params.schoolId || driver.schoolId;

    // 2. Identify target trip
    let targetTripId = explicitTripId;

    if (!targetTripId) {
      // Find active trip in transit for this driver
      const activeRows = await query<{
        id: string;
        bus_id: string;
        status: TripStatus;
      }>(
        `SELECT t.id, t.bus_id, t.status
         FROM trips t
         WHERE t.driver_id = $1 AND t.school_id = $2
           AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
           AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC
         LIMIT 1`,
        [driver.id, schoolId]
      );

      if (activeRows.length === 0 || !activeRows[0]) {
        // Check if driver has a trip already completed today (idempotency check)
        const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        const recentlyCompleted = await query<{ id: string }>(
          `SELECT t.id FROM trips t
           WHERE t.driver_id = $1 AND t.school_id = $2
             AND t.status = 'COMPLETED'
             AND t.scheduled_date = $3::date
             AND t.deleted_at IS NULL
           ORDER BY t.actual_end_time DESC NULLS LAST, t.updated_at DESC
           LIMIT 1`,
          [driver.id, schoolId, todayDate]
        );

        if (recentlyCompleted.length > 0 && recentlyCompleted[0]) {
          const tripId = recentlyCompleted[0].id;
          const trip = await TripService.getTripById(schoolId, tripId, {
            userId: driver.id,
            isDriver: true,
            userRole: 'DRIVER',
          });
          const summary = await TripService.getTripSummary(schoolId, tripId, {
            userId: driver.id,
            isDriver: true,
            userRole: 'DRIVER',
          });

          const routeLabel = summary.routeCode
            ? `${summary.routeCode} - ${summary.routeName || 'Assigned Route'}`
            : summary.routeName || 'Assigned Route';

          const replyText =
            `🏁 *Trip Already Completed*\n\n` +
            `Route: *${routeLabel}*\n` +
            `Bus: *${summary.busNumber || trip.busNumber || 'Assigned Bus'}*\n` +
            `Duration: *${summary.durationMinutes} mins*\n` +
            `Attendance: *${summary.attendance.totalBoarded} / ${summary.attendance.totalExpected} boarded*\n\n` +
            `Attendance ledger is locked. Reply *menu* to return to the main menu.`;

          return {
            success: true,
            alreadyCompleted: true,
            trip,
            summary,
            driver: {
              id: driver.id,
              fullName: driver.fullName,
              phone: driver.phone,
            },
            bus: {
              id: trip.busId,
              busNumber: trip.busNumber || '',
              registrationNumber: trip.busRegistrationNumber || '',
            },
            attendanceLocked: true,
            trackingSessionActive: false,
            replyText,
          };
        }

        throw new BadRequestError(
          'You do not currently have an active trip in transit to complete. Reply 1 to start today’s trip.',
          { errorCode: 'NO_ACTIVE_TRIP' }
        );
      }

      targetTripId = activeRows[0].id;
    }

    // 3. Complete trip via TripService (stops tracking, locks attendance, publishes real-time event)
    const completedTrip = await TripService.completeTrip(
      schoolId,
      targetTripId,
      {
        userId: driver.id,
        isDriver: true,
        userRole: 'DRIVER',
      },
      {
        endedAt,
        summaryNotes,
      }
    );

    // 4. Retrieve operational summary
    const summary = await TripService.getTripSummary(
      schoolId,
      targetTripId,
      {
        userId: driver.id,
        isDriver: true,
        userRole: 'DRIVER',
      }
    );

    // 5. Format structured WhatsApp message for driver
    const routeLabel = summary.routeCode
      ? `${summary.routeCode} - ${summary.routeName || 'Assigned Route'}`
      : summary.routeName || 'Assigned Route';

    const boardingRate =
      summary.attendance.totalExpected > 0
        ? Math.round((summary.attendance.totalBoarded / summary.attendance.totalExpected) * 100)
        : 100;

    const replyText =
      `🏁 *Trip Completed Successfully!*\n\n` +
      `Route: *${routeLabel}*\n` +
      `Bus: *${summary.busNumber || completedTrip.busNumber}* (${summary.busRegistrationNumber || completedTrip.busRegistrationNumber})\n` +
      `Duration: *${summary.durationMinutes} minutes*\n` +
      `Stops Completed: *${summary.stopsCompleted} / ${summary.totalStops}*\n\n` +
      `📋 *Attendance Summary:*\n` +
      `• Expected Students: *${summary.attendance.totalExpected}*\n` +
      `• Boarded: *${summary.attendance.totalBoarded}* (${boardingRate}%)\n` +
      `• Deboarded: *${summary.attendance.totalDeboarded}*\n` +
      `• Absent / Not Boarded: *${summary.attendance.totalAbsent}*\n\n` +
      `🔒 Attendance ledger is locked. Live tracking session concluded.\n\n` +
      `Reply *menu* to return to the main menu.`;

    return {
      success: true,
      alreadyCompleted: false,
      trip: completedTrip,
      summary,
      driver: {
        id: driver.id,
        fullName: driver.fullName,
        phone: driver.phone,
      },
      bus: {
        id: completedTrip.busId,
        busNumber: completedTrip.busNumber || '',
        registrationNumber: completedTrip.busRegistrationNumber || '',
      },
      attendanceLocked: true,
      trackingSessionActive: false,
      replyText,
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

export const DriverWhatsAppService = DriverWhatsappService;
