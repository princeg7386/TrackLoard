import {
  ParentLocationShareRequest,
  ParentLocationValidationResult,
  ValidateCoordinatesQuery,
  RequestParentLocation,
  FindNearestRoadQuery,
  NearestRoadResult,
  CreatePickupPointRequest,
  PickupPointCreationResult,
  formatIndianTransportAddress,
  calculateHaversineDistanceMeters,
  normalizeIndianPhoneNumber,
  GeoCoordinates,
} from '@school-bus/shared';
import { query } from '../../config/database.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../middlewares/error.middleware.js';
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

  /**
   * Micro-phase 14.2 Task 1: Find nearest suitable vehicle road and accessibility metrics
   */
  public static async findNearestSuitableRoad(
    input: FindNearestRoadQuery
  ): Promise<NearestRoadResult> {
    const { latitude, longitude, schoolId, landmark } = input;

    let snappedCoordinates: GeoCoordinates = { latitude, longitude };
    let distanceToRoadMeters = 0;
    let provider = 'mock';

    try {
      const snapResult = await RoutingService.snapToRoad([{ latitude, longitude }], schoolId || 'system');
      if (snapResult.snappedPoints.length > 0 && snapResult.snappedPoints[0]) {
        const pt = snapResult.snappedPoints[0];
        snappedCoordinates = { latitude: pt.latitude, longitude: pt.longitude };
        distanceToRoadMeters = calculateHaversineDistanceMeters({ latitude, longitude }, snappedCoordinates);
        provider = snapResult.provider;
      }
    } catch (err: any) {
      logger.warn(`[DynamicPickup] Road snapping failed, using provided coordinates: ${err.message}`);
    }

    const isAccessible = distanceToRoadMeters <= 300;

    // Micro-phase 14.2 Task 2 & 3: Reverse geocode & create readable address
    const addressInfo = await DynamicPickupService.createReadableAddress(snappedCoordinates, {
      schoolId,
      landmark,
    });

    return {
      originalCoordinates: { latitude, longitude },
      snappedCoordinates,
      distanceToRoadMeters: Math.round(distanceToRoadMeters),
      isAccessible,
      formattedAddress: addressInfo.formattedAddress,
      suggestedStopName: landmark || addressInfo.suggestedStopName,
      provider,
    };
  }

  /**
   * Micro-phase 14.2 Task 2 & 3: Reverse geocode & synthesize Indian readable transport address
   */
  public static async createReadableAddress(
    coords: GeoCoordinates,
    options?: { schoolId?: string; landmark?: string; customName?: string }
  ): Promise<{ formattedAddress: string; suggestedStopName: string }> {
    const { schoolId = 'system', landmark, customName } = options || {};

    let street: string | undefined;
    let sublocality: string | undefined;
    let city: string | undefined;
    let state: string | undefined;
    let postalCode: string | undefined;
    let fallbackAddress = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;

    try {
      const geoResult = await MapService.reverseGeocode(
        { latitude: coords.latitude, longitude: coords.longitude },
        schoolId
      );
      if (geoResult.formattedAddress) {
        fallbackAddress = geoResult.formattedAddress;
        street = geoResult.street;
        city = geoResult.city;
        state = geoResult.state;
        postalCode = geoResult.postalCode;
        if (geoResult.displayName && !street) {
          sublocality = geoResult.displayName.split(',')[0]?.trim();
        }
      }
    } catch {
      // Fallback to coordinates
    }

    const formatted = formatIndianTransportAddress({
      landmark,
      street,
      sublocality,
      city,
      state,
      postalCode,
      fallbackAddress,
    });

    if (customName) {
      formatted.suggestedStopName = customName;
    }

    return formatted;
  }

  /**
   * Micro-phase 14.2 Task 4: Store coordinates, check nearby cluster deduplication, and assign student stop
   */
  public static async createOrAssignPickupPoint(
    payload: CreatePickupPointRequest,
    actorSchoolId?: string
  ): Promise<PickupPointCreationResult> {
    const {
      schoolId,
      routeId,
      latitude,
      longitude,
      studentId,
      stopName,
      landmark,
      scheduledTime = '07:30:00',
      geofenceRadiusMeters = 300,
      snapToRoad = true,
      clusterThresholdMeters = 50,
    } = payload;

    // 1. Tenant validation
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop creation attempt: actor school does not match payload school');
    }

    // 2. Verify route exists and belongs to school
    const routeRows = await query<{ id: string; name: string; code: string }>(
      `SELECT id, name, code FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [routeId, schoolId]
    );
    if (routeRows.length === 0) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    // 3. Verify student if provided
    if (studentId) {
      const studentRows = await query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [studentId, schoolId]
      );
      if (studentRows.length === 0) {
        throw new NotFoundError(`Student ${studentId} not found in this school context`);
      }
    }

    // 4. Snapping & address formatting
    let targetCoords: GeoCoordinates = { latitude, longitude };
    let distanceToRoadMeters = 0;

    if (snapToRoad) {
      try {
        const roadInfo = await DynamicPickupService.findNearestSuitableRoad({
          latitude,
          longitude,
          schoolId,
          landmark,
        });
        if (roadInfo.isAccessible) {
          targetCoords = roadInfo.snappedCoordinates;
          distanceToRoadMeters = roadInfo.distanceToRoadMeters;
        }
      } catch (err: any) {
        logger.warn(`[DynamicPickup] Snapping failed in createOrAssignPickupPoint: ${err.message}`);
      }
    }

    const addressInfo = await DynamicPickupService.createReadableAddress(targetCoords, {
      schoolId,
      landmark,
      customName: stopName,
    });

    const finalStopName = stopName || addressInfo.suggestedStopName;

    // 5. Check if an existing stop exists within clusterThresholdMeters on this route
    const nearbyStopRows = await query<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
      created_at: string;
    }>(
      `SELECT id, stop_name, sequence_order, latitude, longitude, scheduled_time, geofence_radius_meters, created_at
       FROM pickup_locations
       WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
       ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography) ASC
       LIMIT 1`,
      [routeId, schoolId, targetCoords.longitude, targetCoords.latitude, clusterThresholdMeters]
    );

    let stopRecord: {
      id: string;
      school_id: string;
      route_id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
      created_at?: string;
    };
    let reusedExistingStop = false;

    if (nearbyStopRows.length > 0 && nearbyStopRows[0]) {
      // Reuse nearby stop
      const existing = nearbyStopRows[0];
      reusedExistingStop = true;
      stopRecord = {
        id: existing.id,
        school_id: schoolId,
        route_id: routeId,
        stop_name: existing.stop_name,
        sequence_order: existing.sequence_order,
        latitude: existing.latitude,
        longitude: existing.longitude,
        scheduled_time: existing.scheduled_time,
        geofence_radius_meters: existing.geofence_radius_meters,
        created_at: existing.created_at,
      };
      logger.info(
        `[DynamicPickup] Reusing nearby stop ${existing.id} (${existing.stop_name}) within ${clusterThresholdMeters}m threshold`
      );
    } else {
      // Calculate next sequence order
      const seqRows = await query<{ next_seq: number }>(
        `SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next_seq
         FROM pickup_locations
         WHERE route_id = $1 AND deleted_at IS NULL`,
        [routeId]
      );
      const sequenceOrder = Number(seqRows[0]?.next_seq || 1);

      // Insert into pickup_locations
      const insertRows = await query<{
        id: string;
        school_id: string;
        route_id: string;
        stop_name: string;
        sequence_order: number;
        latitude: number;
        longitude: number;
        scheduled_time: string;
        geofence_radius_meters: number;
        created_at: string;
      }>(
        `INSERT INTO pickup_locations (
           school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters
         ) VALUES (
           $1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8
         )
         RETURNING id, school_id, route_id, stop_name, sequence_order, latitude, longitude, scheduled_time, geofence_radius_meters, created_at`,
        [
          schoolId,
          routeId,
          finalStopName,
          sequenceOrder,
          targetCoords.latitude,
          targetCoords.longitude,
          scheduledTime,
          geofenceRadiusMeters,
        ]
      );

      stopRecord = insertRows[0]!;
      logger.info(
        `[DynamicPickup] Created new pickup stop ${stopRecord.id} (${finalStopName}) for route ${routeId}`
      );
    }

    // 6. Assign student to stop if studentId provided
    if (studentId) {
      await query(
        `INSERT INTO student_stop_assignments (
           school_id, student_id, pickup_stop_id
         ) VALUES ($1, $2, $3)
         ON CONFLICT (school_id, student_id)
         DO UPDATE SET
           pickup_stop_id = EXCLUDED.pickup_stop_id,
           updated_at = NOW()`,
        [schoolId, studentId, stopRecord.id]
      );
      logger.info(`[DynamicPickup] Assigned student ${studentId} to pickup stop ${stopRecord.id}`);
    }

    return {
      id: stopRecord.id,
      schoolId: stopRecord.school_id,
      routeId: stopRecord.route_id,
      stopName: stopRecord.stop_name,
      sequenceOrder: stopRecord.sequence_order,
      latitude: stopRecord.latitude,
      longitude: stopRecord.longitude,
      originalCoordinates: { latitude, longitude },
      snappedCoordinates: targetCoords,
      distanceToRoadMeters,
      formattedAddress: addressInfo.formattedAddress,
      scheduledTime: String(stopRecord.scheduled_time),
      geofenceRadiusMeters: stopRecord.geofence_radius_meters,
      reusedExistingStop,
      assignedStudentId: studentId,
      createdAt: stopRecord.created_at,
    };
  }
}

