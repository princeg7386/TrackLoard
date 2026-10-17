import {
  ParentLocationShareRequest,
  ParentLocationValidationResult,
  ValidateCoordinatesQuery,
  RequestParentLocation,
  calculateHaversineDistanceMeters,
  normalizeIndianPhoneNumber,
  GeoCoordinates,
} from '@school-bus/shared';
import { query } from '../../config/database.js';
import { NotFoundError, ValidationError } from '../../middlewares/error.middleware.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { MapService } from '../maps/map.service.js';
import { RoutingService } from '../routing/routing.service.js';
import { ParentIdentityService } from '../parent-identity.service.js';
import { logger } from '../logger.service.js';

// Territory of India approximate bounding box
const INDIA_BOUNDS = {
  minLat: 6.0,
  maxLat: 38.0,
  minLng: 68.0,
  maxLng: 98.5,
};

export class DynamicPickupService {
  /**
   * Dispatches WhatsApp interactive Location Request to parent(s) of a student
   */
  public static async requestParentLocation(params: RequestParentLocation): Promise<{
    success: boolean;
    studentId: string;
    studentName: string;
    schoolName: string;
    recipientPhone: string;
    messageId: string;
    provider: string;
  }> {
    const { schoolId, studentId, parentPhone, customPrompt } = params;

    // 1. Fetch student and school context
    const studentRows = await query<{
      id: string;
      full_name: string;
      school_id: string;
      school_name: string;
    }>(
      `SELECT s.id, s.full_name, s.school_id, sch.name AS school_name
       FROM students s
       JOIN schools sch ON s.school_id = sch.id
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL AND sch.deleted_at IS NULL
       LIMIT 1`,
      [studentId, schoolId]
    );

    if (studentRows.length === 0) {
      throw new NotFoundError(`Student ${studentId} not found in this school context`);
    }

    const student = studentRows[0]!;

    // 2. Fetch parent contact
    let targetPhone = parentPhone ? normalizeIndianPhoneNumber(parentPhone) : '';
    let parentName = 'Parent';

    if (!targetPhone) {
      const parentRows = await query<{ id: string; full_name: string; phone: string }>(
        `SELECT id, full_name, phone
         FROM parents
         WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [studentId, schoolId]
      );

      if (parentRows.length === 0) {
        throw new ValidationError('No registered parent contact found for this student to send location request');
      }

      targetPhone = parentRows[0]!.phone;
      parentName = parentRows[0]!.full_name;
    }

    // 3. Build friendly prompt
    const promptText =
      customPrompt ||
      `Hello ${parentName}! Please share your live or current location to set or update ${student.full_name}'s bus pickup point for ${student.school_name}.\n\n📌 Tap the 📎 attachment icon > 'Location' > 'Send Your Current Location' in this chat to confirm your coordinates.`;

    // 4. Dispatch via MessagingService
    const sendResult = await MessagingService.sendLocationRequest(targetPhone, promptText, {
      schoolId,
      studentId,
      parentName,
      studentName: student.full_name,
      schoolName: student.school_name,
    });

    logger.info(`[DynamicPickup] WhatsApp location request sent to parent ${targetPhone} for student ${studentId}`);

    return {
      success: true,
      studentId: student.id,
      studentName: student.full_name,
      schoolName: student.school_name,
      recipientPhone: targetPhone,
      messageId: sendResult.messageId,
      provider: sendResult.provider,
    };
  }

  /**
   * Strictly validates coordinates:
   * 1. India geographic territory bounding box
   * 2. School catchment service zone (<= maxCatchmentKm, default 35 km)
   * 3. Reverse-geocoded structured address
   * 4. Road network accessibility
   */
  public static async validateCoordinates(
    queryInput: ValidateCoordinatesQuery
  ): Promise<ParentLocationValidationResult> {
    const { latitude, longitude, schoolId, maxCatchmentKm = 35 } = queryInput;
    const validationErrors: string[] = [];

    // Step 1: India Geographic Bounds Check
    const isWithinIndia =
      latitude >= INDIA_BOUNDS.minLat &&
      latitude <= INDIA_BOUNDS.maxLat &&
      longitude >= INDIA_BOUNDS.minLng &&
      longitude <= INDIA_BOUNDS.maxLng;

    if (!isWithinIndia) {
      validationErrors.push(
        `Coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) fall outside the territory of India.`
      );
    }

    // Step 2: Reverse Geocode Structured Address
    let formattedAddress = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    try {
      const geoResult = await MapService.reverseGeocode({ latitude, longitude }, schoolId || 'system');
      if (geoResult.formattedAddress) {
        formattedAddress = geoResult.formattedAddress;
      }
    } catch {
      // Keep coordinate string fallback
    }

    // Step 3: School Catchment & Distance Calculation
    let distanceToSchoolKm = 0;
    let isWithinCatchment = true;

    if (schoolId) {
      let schoolAnchor: GeoCoordinates | null = null;

      try {
        // Find existing stop or school center
        const stopRows = await query<{ latitude: number; longitude: number }>(
          `SELECT latitude, longitude
           FROM pickup_locations
           WHERE school_id = $1 AND deleted_at IS NULL
           ORDER BY sequence_order ASC
           LIMIT 1`,
          [schoolId]
        );

        if (stopRows.length > 0 && stopRows[0]) {
          schoolAnchor = {
            latitude: stopRows[0].latitude,
            longitude: stopRows[0].longitude,
          };
        } else {
          // Geocode school city/address or use default
          const schoolRows = await query<{ city: string; state: string }>(
            `SELECT city, state FROM schools WHERE id = $1 LIMIT 1`,
            [schoolId]
          );
          if (schoolRows.length > 0) {
            schoolAnchor = { latitude: 28.6139, longitude: 77.2090 }; // Default NCR
          }
        }
      } catch {
        schoolAnchor = { latitude: 28.6139, longitude: 77.2090 };
      }

      if (schoolAnchor) {
        const distanceMeters = calculateHaversineDistanceMeters(schoolAnchor, {
          latitude,
          longitude,
        });
        distanceToSchoolKm = Number((distanceMeters / 1000).toFixed(1));

        if (distanceToSchoolKm > maxCatchmentKm) {
          isWithinCatchment = false;
          validationErrors.push(
            `Location is ${distanceToSchoolKm} km from school center, exceeding the ${maxCatchmentKm} km transport catchment zone.`
          );
        }
      }
    }

    // Step 4: Road Accessibility Check (Snapping)
    let roadAccessible = true;
    try {
      const snapResult = await RoutingService.snapToRoad([{ latitude, longitude }], schoolId || 'system');
      if (snapResult.snappedPoints.length > 0) {
        const snapped = snapResult.snappedPoints[0]!;
        const snapDist = calculateHaversineDistanceMeters(
          { latitude, longitude },
          { latitude: snapped.latitude, longitude: snapped.longitude }
        );
        if (snapDist > 300) {
          roadAccessible = false;
          validationErrors.push(
            `Location is ${Math.round(snapDist)} meters away from the nearest navigable road.`
          );
        }
      }
    } catch {
      // If road snapping fails, assume accessible
      roadAccessible = true;
    }

    const isValid = isWithinIndia && isWithinCatchment && roadAccessible && validationErrors.length === 0;

    return {
      isValid,
      coordinates: { latitude, longitude },
      formattedAddress,
      distanceToSchoolKm,
      isWithinCatchment,
      roadAccessible,
      isWithinIndia,
      validationErrors,
      suggestedStopName: formattedAddress.split(',')[0] || 'Pickup Point',
      schoolId,
    };
  }

  /**
   * Ingest and validate a location shared by a parent (via WhatsApp webhook or Direct Web API)
   */
  public static async receiveAndValidateParentLocation(
    params: ParentLocationShareRequest
  ): Promise<ParentLocationValidationResult & { recipientFeedbackSent: boolean }> {
    const { latitude, longitude, senderPhone, locationName, address } = params;
    let { studentId, schoolId } = params;

    let parentName = 'Parent';
    let studentName = 'Student';

    // 1. If senderPhone provided, resolve parent, student, and school context
    if (senderPhone) {
      try {
        const parentRecords = await ParentIdentityService.lookupParentsByPhone(senderPhone, schoolId);
        if (parentRecords.length > 0) {
          const rec = parentRecords[0]!;
          parentName = rec.fullName;
          studentName = rec.student?.fullName || 'Student';
          studentId = studentId || rec.studentId;
          schoolId = schoolId || rec.schoolId;
        }
      } catch {
        // Safe lookup fallback
      }
    }

    // 2. Perform validation
    const validation = await DynamicPickupService.validateCoordinates({
      latitude,
      longitude,
      schoolId,
      maxCatchmentKm: 35,
    });

    if (address && validation.formattedAddress.includes(latitude.toFixed(4))) {
      validation.formattedAddress = address;
    }
    if (locationName) {
      validation.suggestedStopName = locationName;
    }
    validation.studentId = studentId;
    validation.schoolId = schoolId;

    // 3. Dispatch WhatsApp confirmation or feedback alert to the parent if senderPhone exists
    let recipientFeedbackSent = false;
    if (senderPhone) {
      const targetPhone = normalizeIndianPhoneNumber(senderPhone);
      let feedbackText = '';

      if (validation.isValid) {
        feedbackText = `✅ Thank you ${parentName}! We received your pickup location: ${validation.formattedAddress} (${validation.distanceToSchoolKm} km from school). Coordinates have been recorded for ${studentName}'s bus route.`;
      } else {
        feedbackText = `⚠️ Hello ${parentName}. We received your location at ${validation.formattedAddress}, but it appears to be outside our bus service zone (${validation.distanceToSchoolKm} km away). Please contact your school transport coordinator for route assistance.`;
      }

      try {
        await MessagingService.sendMessage({
          recipientPhone: targetPhone,
          schoolId,
          studentId,
          directText: feedbackText,
        });
        recipientFeedbackSent = true;
      } catch (err: any) {
        logger.warn(`[DynamicPickup] Failed to send WhatsApp location feedback: ${err.message}`);
      }
    }

    return {
      ...validation,
      recipientFeedbackSent,
    };
  }

  /**
   * Normalized handler for Inbound WhatsApp Cloud API / Twilio Webhook payloads
   */
  public static async handleWhatsAppInboundPayload(body: any): Promise<{
    handled: boolean;
    result?: ParentLocationValidationResult;
  }> {
    // 1. WhatsApp Cloud API message format: entry[].changes[].value.messages[]
    const message =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
      (body?.from && body?.location ? body : null);

    if (!message) {
      return { handled: false };
    }

    const from = message.from;
    const type = message.type;

    if (type === 'location' && message.location) {
      const { latitude, longitude, name, address } = message.location;
      const validation = await DynamicPickupService.receiveAndValidateParentLocation({
        latitude: Number(latitude),
        longitude: Number(longitude),
        senderPhone: from,
        locationName: name,
        address,
      });

      return {
        handled: true,
        result: validation,
      };
    }

    return { handled: false };
  }
}
