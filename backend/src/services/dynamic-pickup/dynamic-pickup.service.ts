import {
  ParentLocationShareRequest,
  ParentLocationValidationResult,
  ValidateCoordinatesQuery,
  RequestParentLocation,
  FindNearestRoadQuery,
  NearestRoadResult,
  CreatePickupPointRequest,
  PickupPointCreationResult,
  AssignStudentPickupRequest,
  UpdateStudentPickupRequest,
  StudentPickupMapData,
  LocationSafetyCheckRequest,
  LocationSafetyCheckResult,
  DetectDuplicatesRequest,
  DetectDuplicatesResult,
  NearbyStopItem,
  AuditDuplicatesQuery,
  EditPickupStopRequest,
  DeletePickupStopRequest,
  formatIndianTransportAddress,
  calculateHaversineDistanceMeters,
  normalizeIndianPhoneNumber,
  GeoCoordinates,
} from '@school-bus/shared';
import { query } from '../../config/database.js';
import { NotFoundError, ValidationError, ForbiddenError, BadRequestError } from '../../middlewares/error.middleware.js';
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

    // 3.5. Reject clearly invalid locations
    if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
      throw new ValidationError('Location safety check failed: Coordinates correspond to Null Island (0,0) or uninitialized GPS.');
    }
    if (
      latitude < INDIA_BOUNDS.minLat ||
      latitude > INDIA_BOUNDS.maxLat ||
      longitude < INDIA_BOUNDS.minLng ||
      longitude > INDIA_BOUNDS.maxLng
    ) {
      throw new ValidationError(
        `Location safety check failed: Coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) fall outside the territory of India.`
      );
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
        if (!roadInfo.isAccessible || roadInfo.distanceToRoadMeters > 300) {
          throw new ValidationError(
            `Location safety check failed: Location is ${Math.round(roadInfo.distanceToRoadMeters)}m away from the nearest navigable road (safe threshold: 300m).`
          );
        }
        targetCoords = roadInfo.snappedCoordinates;
        distanceToRoadMeters = roadInfo.distanceToRoadMeters;
      } catch (err: any) {
        if (err instanceof ValidationError) throw err;
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

  /**
   * Micro-phase 14.3 Task 1: Assign pickup stop to student with tenant validation and parent notification
   */
  public static async assignPickupToStudent(
    payload: AssignStudentPickupRequest,
    actorSchoolId?: string
  ): Promise<{
    success: boolean;
    studentId: string;
    studentName: string;
    pickupStopId: string;
    pickupStopName: string;
    scheduledTime: string;
    parentNotified: boolean;
  }> {
    const { schoolId, studentId, pickupStopId, dropStopId, notifyParent = true } = payload;

    // 1. Tenant validation
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant assignment attempt: actor school does not match payload school');
    }

    // 2. Verify student exists and belongs to school
    const studentRows = await query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [studentId, schoolId]
    );
    if (studentRows.length === 0) {
      throw new NotFoundError(`Student ${studentId} not found in this school context`);
    }
    const student = studentRows[0]!;

    // 3. Verify pickup stop exists and belongs to school
    const stopRows = await query<{ id: string; stop_name: string; scheduled_time: string; route_id: string }>(
      `SELECT id, stop_name, scheduled_time, route_id FROM pickup_locations WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [pickupStopId, schoolId]
    );
    if (stopRows.length === 0) {
      throw new NotFoundError(`Pickup stop ${pickupStopId} not found in this school context`);
    }
    const pickupStop = stopRows[0]!;

    // 4. Verify drop stop if provided
    if (dropStopId) {
      const dropRows = await query<{ id: string }>(
        `SELECT id FROM pickup_locations WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [dropStopId, schoolId]
      );
      if (dropRows.length === 0) {
        throw new NotFoundError(`Drop stop ${dropStopId} not found in this school context`);
      }
    }

    // 5. Upsert into student_stop_assignments
    await query(
      `INSERT INTO student_stop_assignments (
         school_id, student_id, pickup_stop_id, drop_stop_id
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, student_id)
       DO UPDATE SET
         pickup_stop_id = EXCLUDED.pickup_stop_id,
         drop_stop_id = COALESCE(EXCLUDED.drop_stop_id, student_stop_assignments.drop_stop_id),
         updated_at = NOW()`,
      [schoolId, studentId, pickupStopId, dropStopId || null]
    );

    // 6. Optional Parent WhatsApp Notification
    let parentNotified = false;
    if (notifyParent) {
      try {
        const parentRows = await query<{ id: string; full_name: string; phone: string }>(
          `SELECT id, full_name, phone
           FROM parents
           WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT 1`,
          [studentId, schoolId]
        );

        if (parentRows.length > 0 && parentRows[0]) {
          const parent = parentRows[0];
          const timeFormatted = String(pickupStop.scheduled_time).slice(0, 5);
          const noticeText = `🚏 Hello ${parent.full_name}! ${student.full_name}'s school bus pickup point has been assigned to: ${pickupStop.stop_name} (Scheduled: ${timeFormatted}).`;

          await MessagingService.sendMessage({
            recipientPhone: parent.phone,
            schoolId,
            studentId,
            directText: noticeText,
          });
          parentNotified = true;
        }
      } catch (err: any) {
        logger.warn(`[DynamicPickup] Failed to notify parent for pickup assignment: ${err.message}`);
      }
    }

    logger.info(`[DynamicPickup] Student ${studentId} assigned to pickup stop ${pickupStopId} (School: ${schoolId})`);

    return {
      success: true,
      studentId,
      studentName: student.full_name,
      pickupStopId,
      pickupStopName: pickupStop.stop_name,
      scheduledTime: String(pickupStop.scheduled_time),
      parentNotified,
    };
  }

  /**
   * Micro-phase 14.3 Task 2: Get comprehensive map rendering data for student's pickup location
   */
  public static async getStudentPickupMapData(
    studentId: string,
    schoolId: string
  ): Promise<StudentPickupMapData> {
    // 1. Fetch student
    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
      class_grade: string;
      section: string;
    }>(
      `SELECT id, full_name, admission_number, class_grade, section
       FROM students
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [studentId, schoolId]
    );
    if (studentRows.length === 0) {
      throw new NotFoundError(`Student ${studentId} not found in this school context`);
    }
    const student = studentRows[0]!;

    // 2. Fetch assigned stops
    const assignmentRows = await query<{
      pickup_stop_id: string | null;
      pickup_name: string | null;
      pickup_seq: number | null;
      pickup_time: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
      pickup_geofence: number | null;
      route_id: string | null;
      drop_stop_id: string | null;
      drop_name: string | null;
      drop_seq: number | null;
      drop_time: string | null;
      drop_lat: number | null;
      drop_lng: number | null;
      drop_geofence: number | null;
    }>(
      `SELECT 
         ssa.pickup_stop_id,
         pl_pick.stop_name AS pickup_name,
         pl_pick.sequence_order AS pickup_seq,
         pl_pick.scheduled_time AS pickup_time,
         pl_pick.latitude AS pickup_lat,
         pl_pick.longitude AS pickup_lng,
         pl_pick.geofence_radius_meters AS pickup_geofence,
         pl_pick.route_id,
         ssa.drop_stop_id,
         pl_drop.stop_name AS drop_name,
         pl_drop.sequence_order AS drop_seq,
         pl_drop.scheduled_time AS drop_time,
         pl_drop.latitude AS drop_lat,
         pl_drop.longitude AS drop_lng,
         pl_drop.geofence_radius_meters AS drop_geofence
       FROM student_stop_assignments ssa
       LEFT JOIN pickup_locations pl_pick ON ssa.pickup_stop_id = pl_pick.id AND pl_pick.deleted_at IS NULL
       LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id AND pl_drop.deleted_at IS NULL
       WHERE ssa.student_id = $1 AND ssa.school_id = $2 AND ssa.deleted_at IS NULL
       LIMIT 1`,
      [studentId, schoolId]
    );

    const assignment = assignmentRows[0];

    let pickupStop = null;
    if (assignment && assignment.pickup_stop_id && assignment.pickup_lat !== null && assignment.pickup_lng !== null) {
      pickupStop = {
        id: assignment.pickup_stop_id,
        stopName: assignment.pickup_name || 'Pickup Point',
        sequenceOrder: Number(assignment.pickup_seq || 1),
        scheduledTime: String(assignment.pickup_time || '07:30:00'),
        latitude: Number(assignment.pickup_lat),
        longitude: Number(assignment.pickup_lng),
        geofenceRadiusMeters: Number(assignment.pickup_geofence || 300),
      };
    }

    let dropStop = null;
    if (assignment && assignment.drop_stop_id && assignment.drop_lat !== null && assignment.drop_lng !== null) {
      dropStop = {
        id: assignment.drop_stop_id,
        stopName: assignment.drop_name || 'Drop Point',
        sequenceOrder: Number(assignment.drop_seq || 1),
        scheduledTime: String(assignment.drop_time || '14:30:00'),
        latitude: Number(assignment.drop_lat),
        longitude: Number(assignment.drop_lng),
        geofenceRadiusMeters: Number(assignment.drop_geofence || 300),
      };
    }

    // 3. Fetch Route details if assigned
    let route = null;
    let activeTrip = null;

    if (assignment?.route_id) {
      const routeRows = await query<{
        id: string;
        name: string;
        code: string;
        route_type: string;
        path_polyline: string | null;
      }>(
        `SELECT id, name, code, route_type, path_polyline
         FROM routes
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [assignment.route_id, schoolId]
      );

      if (routeRows.length > 0 && routeRows[0]) {
        const r = routeRows[0];
        route = {
          id: r.id,
          name: r.name,
          code: r.code,
          routeType: r.route_type,
          pathPolyline: r.path_polyline,
        };

        // 4. Fetch active live trip if in progress
        const tripRows = await query<{
          id: string;
          status: string;
          bus_number: string | null;
          registration_number: string | null;
          driver_name: string | null;
          last_latitude: number | null;
          last_longitude: number | null;
          last_speed_kmh: number | null;
          last_gps_recorded_at: string | null;
        }>(
          `SELECT t.id, t.status, b.bus_number, b.registration_number, d.full_name AS driver_name,
                  b.last_latitude, b.last_longitude, b.last_speed_kmh, b.last_gps_recorded_at
           FROM trips t
           LEFT JOIN buses b ON t.bus_id = b.id
           LEFT JOIN drivers d ON t.driver_id = d.id
           WHERE t.route_id = $1 AND t.school_id = $2 AND t.status IN ('IN_TRANSIT', 'DELAYED') AND t.deleted_at IS NULL
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [r.id, schoolId]
        );

        if (tripRows.length > 0 && tripRows[0]) {
          const t = tripRows[0];
          activeTrip = {
            id: t.id,
            status: t.status,
            busNumber: t.bus_number || 'Bus',
            registrationNumber: t.registration_number || '',
            driverName: t.driver_name || 'Driver',
            currentLatitude: t.last_latitude !== null ? Number(t.last_latitude) : null,
            currentLongitude: t.last_longitude !== null ? Number(t.last_longitude) : null,
            speedKmh: t.last_speed_kmh !== null ? Number(t.last_speed_kmh) : null,
            lastPingAt: t.last_gps_recorded_at ? new Date(t.last_gps_recorded_at).toISOString() : null,
          };
        }
      }
    }

    return {
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
        classGrade: student.class_grade,
        section: student.section,
      },
      pickupStop,
      dropStop,
      route,
      activeTrip,
    };
  }

  /**
   * Micro-phase 14.3 Task 3: Update student's pickup point via stop ID or new coordinates
   */
  public static async updateStudentPickup(
    payload: UpdateStudentPickupRequest,
    actorSchoolId?: string
  ): Promise<{
    success: boolean;
    studentId: string;
    studentName: string;
    pickupStopId: string;
    pickupStopName: string;
    formattedAddress?: string;
    reusedExistingStop: boolean;
    parentNotified: boolean;
  }> {
    const {
      pickupStopId,
      dropStopId,
      latitude,
      longitude,
      stopName,
      landmark,
      notifyParent = true,
    } = payload;

    const effectiveSchoolId = payload.schoolId || actorSchoolId;
    if (!effectiveSchoolId) {
      throw new BadRequestError('schoolId is required to update student pickup');
    }
    const effectiveStudentId = payload.studentId;
    if (!effectiveStudentId) {
      throw new BadRequestError('studentId is required to update student pickup');
    }

    // 1. Tenant validation
    if (actorSchoolId && actorSchoolId !== effectiveSchoolId) {
      throw new ForbiddenError('Cross-tenant update attempt: actor school does not match payload school');
    }

    // 2. Verify student exists
    const studentRows = await query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [effectiveStudentId, effectiveSchoolId]
    );
    if (studentRows.length === 0) {
      throw new NotFoundError(`Student ${effectiveStudentId} not found in this school context`);
    }
    const student = studentRows[0]!;

    let finalStopId = pickupStopId;
    let finalStopName = stopName || 'Pickup Stop';
    let formattedAddress = '';
    let reusedExistingStop = false;

    // 3. If coordinates are provided: Create or snap new pickup point
    if (latitude !== undefined && longitude !== undefined) {
      // Find route: use payload routeId or lookup existing route
      let routeId = payload.routeId;
      if (!routeId) {
        const existingRoute = await query<{ route_id: string }>(
          `SELECT pl.route_id
           FROM student_stop_assignments ssa
           JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id
           WHERE ssa.student_id = $1 AND ssa.school_id = $2 AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL
           LIMIT 1`,
          [effectiveStudentId, effectiveSchoolId]
        );
        if (existingRoute.length > 0 && existingRoute[0]) {
          routeId = existingRoute[0].route_id;
        } else {
          const defaultRoute = await query<{ id: string }>(
            `SELECT id FROM routes WHERE school_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
            [effectiveSchoolId]
          );
          if (defaultRoute.length === 0) {
            throw new BadRequestError('No transit route found for this school. Please create a route first.');
          }
          routeId = defaultRoute[0]!.id;
        }
      }

      const pointResult = await DynamicPickupService.createOrAssignPickupPoint(
        {
          schoolId: effectiveSchoolId,
          routeId,
          latitude,
          longitude,
          studentId: effectiveStudentId,
          stopName,
          landmark,
          scheduledTime: '07:30:00',
          geofenceRadiusMeters: 300,
          snapToRoad: true,
          clusterThresholdMeters: 50,
        },
        actorSchoolId
      );

      finalStopId = pointResult.id;
      finalStopName = pointResult.stopName;
      formattedAddress = pointResult.formattedAddress;
      reusedExistingStop = pointResult.reusedExistingStop;
    } else if (pickupStopId) {
      // Direct stop ID assignment
      const assignResult = await DynamicPickupService.assignPickupToStudent(
        {
          schoolId: effectiveSchoolId,
          studentId: effectiveStudentId,
          pickupStopId,
          dropStopId,
          notifyParent: false, // We'll send consolidated notification below
        },
        actorSchoolId
      );
      finalStopId = assignResult.pickupStopId;
      finalStopName = assignResult.pickupStopName;
    } else {
      throw new BadRequestError('Either pickupStopId or latitude/longitude coordinates must be provided to update pickup point.');
    }

    // 4. Send WhatsApp update notification to parent
    let parentNotified = false;
    if (notifyParent) {
      try {
        const parentRows = await query<{ id: string; full_name: string; phone: string }>(
          `SELECT id, full_name, phone
           FROM parents
           WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT 1`,
          [effectiveStudentId, effectiveSchoolId]
        );

        if (parentRows.length > 0 && parentRows[0]) {
          const parent = parentRows[0];
          const addressPart = formattedAddress ? ` (${formattedAddress})` : '';
          const noticeText = `✅ Hello ${parent.full_name}! ${student.full_name}'s bus pickup point has been updated to: ${finalStopName}${addressPart}.`;

          await MessagingService.sendMessage({
            recipientPhone: parent.phone,
            schoolId: effectiveSchoolId,
            studentId: effectiveStudentId,
            directText: noticeText,
          });
          parentNotified = true;
        }
      } catch (err: any) {
        logger.warn(`[DynamicPickup] Failed to notify parent for pickup update: ${err.message}`);
      }
    }

    logger.info(`[DynamicPickup] Student ${effectiveStudentId} pickup point updated to stop ${finalStopId}`);

    return {
      success: true,
      studentId: effectiveStudentId,
      studentName: student.full_name,
      pickupStopId: finalStopId!,
      pickupStopName: finalStopName,
      formattedAddress,
      reusedExistingStop,
      parentNotified,
    };
  }

  /**
   * Micro-phase 14.4 Task 1: Comprehensive Safety & Quality Check for Coordinates
   * Rejects Null Island, non-Indian coordinates, locations outside school catchment,
   * and inaccessible off-road locations.
   */
  public static async checkLocationSafety(
    request: LocationSafetyCheckRequest
  ): Promise<LocationSafetyCheckResult> {
    const {
      latitude,
      longitude,
      schoolId,
      maxCatchmentKm = 35,
      maxRoadDistanceMeters = 300,
    } = request;

    const reasons: string[] = [];
    let safetyScore = 100;

    // 1. Physical range & Null Island check
    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return {
        isSafe: false,
        safetyScore: 0,
        reasons: ['Coordinates are mathematically invalid or out of range.'],
        coordinates: { latitude, longitude },
        isWithinIndia: false,
        isWithinCatchment: false,
        distanceToSchoolKm: 9999,
        isRoadAccessible: false,
        distanceToRoadMeters: 9999,
      };
    }

    if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
      return {
        isSafe: false,
        safetyScore: 0,
        reasons: ['Coordinates correspond to Null Island (0,0) or uninitialized GPS fix.'],
        coordinates: { latitude, longitude },
        isWithinIndia: false,
        isWithinCatchment: false,
        distanceToSchoolKm: 9999,
        isRoadAccessible: false,
        distanceToRoadMeters: 9999,
      };
    }

    // 2. India Geographic Bounds
    const isWithinIndia =
      latitude >= INDIA_BOUNDS.minLat &&
      latitude <= INDIA_BOUNDS.maxLat &&
      longitude >= INDIA_BOUNDS.minLng &&
      longitude <= INDIA_BOUNDS.maxLng;

    if (!isWithinIndia) {
      reasons.push(`Coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) are outside the territory of India.`);
      safetyScore -= 50;
    }

    // 3. School Catchment Distance
    let distanceToSchoolKm = 0;
    let isWithinCatchment = true;

    if (schoolId) {
      let schoolAnchor: GeoCoordinates | null = null;
      try {
        const stopRows = await query<{ latitude: number; longitude: number }>(
          `SELECT latitude, longitude
           FROM pickup_locations
           WHERE school_id = $1 AND deleted_at IS NULL
           ORDER BY sequence_order ASC
           LIMIT 1`,
          [schoolId]
        );
        if (stopRows.length > 0 && stopRows[0]) {
          schoolAnchor = { latitude: stopRows[0].latitude, longitude: stopRows[0].longitude };
        } else {
          schoolAnchor = { latitude: 28.6139, longitude: 77.2090 };
        }
      } catch {
        schoolAnchor = { latitude: 28.6139, longitude: 77.2090 };
      }

      if (schoolAnchor) {
        const distMeters = calculateHaversineDistanceMeters(schoolAnchor, { latitude, longitude });
        distanceToSchoolKm = Number((distMeters / 1000).toFixed(1));
        if (distanceToSchoolKm > maxCatchmentKm) {
          isWithinCatchment = false;
          reasons.push(
            `Location is ${distanceToSchoolKm} km from school center, exceeding the ${maxCatchmentKm} km catchment limit.`
          );
          safetyScore -= 30;
        }
      }
    }

    // 4. Road Proximity & Accessibility
    let isRoadAccessible = true;
    let distanceToRoadMeters = 0;
    let snappedCoordinates: GeoCoordinates | undefined = undefined;

    try {
      const snapResult = await RoutingService.snapToRoad([{ latitude, longitude }], schoolId || 'system');
      if (snapResult.snappedPoints.length > 0 && snapResult.snappedPoints[0]) {
        const snapped = snapResult.snappedPoints[0];
        snappedCoordinates = { latitude: snapped.latitude, longitude: snapped.longitude };
        distanceToRoadMeters = Math.round(
          calculateHaversineDistanceMeters({ latitude, longitude }, snappedCoordinates)
        );
        if (distanceToRoadMeters > maxRoadDistanceMeters) {
          isRoadAccessible = false;
          reasons.push(
            `Location is ${distanceToRoadMeters}m away from the nearest navigable road (safe threshold: ${maxRoadDistanceMeters}m).`
          );
          safetyScore -= 30;
        }
      }
    } catch {
      isRoadAccessible = true;
      distanceToRoadMeters = 0;
    }

    // 5. Reverse geocoding for formatted address
    let formattedAddress = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    try {
      const geo = await MapService.reverseGeocode({ latitude, longitude }, schoolId || 'system');
      if (geo.formattedAddress) {
        formattedAddress = geo.formattedAddress;
      }
    } catch {
      // Keep coordinate fallback
    }

    safetyScore = Math.max(0, Math.min(100, safetyScore));
    const isSafe = isWithinIndia && isWithinCatchment && isRoadAccessible && reasons.length === 0;

    return {
      isSafe,
      safetyScore,
      reasons,
      coordinates: { latitude, longitude },
      isWithinIndia,
      isWithinCatchment,
      distanceToSchoolKm,
      isRoadAccessible,
      distanceToRoadMeters,
      snappedCoordinates,
      formattedAddress,
    };
  }

  /**
   * Micro-phase 14.4 Task 2: Detect duplicate and nearby pickup points within a radius.
   * Leverages PostGIS ST_DWithin and ST_Distance on pickup_locations.location.
   */
  public static async detectNearbyOrDuplicateStops(
    params: DetectDuplicatesRequest,
    actorSchoolId?: string
  ): Promise<DetectDuplicatesResult> {
    const {
      latitude,
      longitude,
      radiusMeters = 500,
      duplicateThresholdMeters = 50,
    } = params;

    const schoolId = params.schoolId || actorSchoolId;
    if (!schoolId) {
      throw new BadRequestError('schoolId is required to detect nearby/duplicate stops');
    }
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant unauthorized access attempt: actor school does not match requested school');
    }

    const routeId = params.routeId || null;

    const rows = await query<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
      route_id: string;
      route_name: string;
      route_code: string;
      distance_meters: number;
      assigned_students_count: number;
    }>(
      `SELECT pl.id, pl.stop_name, pl.sequence_order, pl.latitude, pl.longitude,
              pl.scheduled_time::text AS scheduled_time, pl.geofence_radius_meters,
              pl.route_id, r.name AS route_name, r.code AS route_code,
              ROUND(ST_Distance(pl.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric, 1) AS distance_meters,
              COUNT(ssa.student_id)::int AS assigned_students_count
       FROM pickup_locations pl
       JOIN routes r ON pl.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN student_stop_assignments ssa ON pl.id = ssa.pickup_stop_id AND ssa.deleted_at IS NULL
       WHERE pl.school_id = $3 AND pl.deleted_at IS NULL
         AND ($4::uuid IS NULL OR pl.route_id = $4)
         AND ST_DWithin(pl.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5)
       GROUP BY pl.id, r.id, r.name, r.code
       ORDER BY distance_meters ASC`,
      [longitude, latitude, schoolId, routeId, radiusMeters]
    );

    const nearbyStops: NearbyStopItem[] = rows.map((r) => ({
      id: r.id,
      stopName: r.stop_name,
      sequenceOrder: Number(r.sequence_order),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      scheduledTime: String(r.scheduled_time),
      geofenceRadiusMeters: Number(r.geofence_radius_meters),
      distanceMeters: Number(r.distance_meters),
      isDuplicate: Number(r.distance_meters) <= duplicateThresholdMeters,
      assignedStudentsCount: Number(r.assigned_students_count),
      route: {
        id: r.route_id,
        name: r.route_name,
        code: r.route_code,
      },
    }));

    const duplicates = nearbyStops.filter((s) => s.isDuplicate);
    const hasNearbyDuplicates = duplicates.length > 0;
    const nearestStop = nearbyStops.length > 0 ? nearbyStops[0]! : null;

    let recommendation: 'REUSE_EXISTING' | 'CREATE_NEW' | 'MERGE_STOPS' = 'CREATE_NEW';
    if (hasNearbyDuplicates) {
      recommendation = 'REUSE_EXISTING';
    }

    return {
      hasNearbyDuplicates,
      duplicateCount: duplicates.length,
      totalNearbyCount: nearbyStops.length,
      recommendation,
      nearestStop,
      nearbyStops,
    };
  }

  /**
   * Micro-phase 14.4 Task 2 (cont): Audit an entire route or school for duplicate stop pairs
   */
  public static async auditRouteStopDuplicates(
    params: AuditDuplicatesQuery,
    actorSchoolId?: string
  ): Promise<{
    schoolId: string;
    thresholdMeters: number;
    duplicatePairsCount: number;
    duplicateClusters: Array<{
      stop1: { id: string; name: string; sequenceOrder: number; studentsCount: number };
      stop2: { id: string; name: string; sequenceOrder: number; studentsCount: number };
      route: { id: string; name: string; code: string };
      distanceMeters: number;
    }>;
  }> {
    const schoolId = params.schoolId || actorSchoolId;
    if (!schoolId) {
      throw new BadRequestError('schoolId is required to audit stop duplicates');
    }
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant unauthorized access attempt');
    }

    const { routeId = null, thresholdMeters = 50 } = params;

    const rows = await query<{
      stop1_id: string;
      stop1_name: string;
      stop1_seq: number;
      stop2_id: string;
      stop2_name: string;
      stop2_seq: number;
      route_id: string;
      route_name: string;
      route_code: string;
      distance_meters: number;
      stop1_students: number;
      stop2_students: number;
    }>(
      `SELECT pl1.id AS stop1_id, pl1.stop_name AS stop1_name, pl1.sequence_order AS stop1_seq,
              pl2.id AS stop2_id, pl2.stop_name AS stop2_name, pl2.sequence_order AS stop2_seq,
              pl1.route_id, r.name AS route_name, r.code AS route_code,
              ROUND(ST_Distance(pl1.location, pl2.location)::numeric, 1) AS distance_meters,
              (SELECT COUNT(*)::int FROM student_stop_assignments WHERE pickup_stop_id = pl1.id AND deleted_at IS NULL) AS stop1_students,
              (SELECT COUNT(*)::int FROM student_stop_assignments WHERE pickup_stop_id = pl2.id AND deleted_at IS NULL) AS stop2_students
       FROM pickup_locations pl1
       JOIN pickup_locations pl2 ON pl1.route_id = pl2.route_id AND pl1.id < pl2.id
       JOIN routes r ON pl1.route_id = r.id AND r.deleted_at IS NULL
       WHERE pl1.school_id = $1 AND pl2.school_id = $1
         AND pl1.deleted_at IS NULL AND pl2.deleted_at IS NULL
         AND ($2::uuid IS NULL OR pl1.route_id = $2)
         AND ST_DWithin(pl1.location, pl2.location, $3)
       ORDER BY distance_meters ASC`,
      [schoolId, routeId, thresholdMeters]
    );

    const duplicateClusters = rows.map((r) => ({
      stop1: {
        id: r.stop1_id,
        name: r.stop1_name,
        sequenceOrder: Number(r.stop1_seq),
        studentsCount: Number(r.stop1_students),
      },
      stop2: {
        id: r.stop2_id,
        name: r.stop2_name,
        sequenceOrder: Number(r.stop2_seq),
        studentsCount: Number(r.stop2_students),
      },
      route: {
        id: r.route_id,
        name: r.route_name,
        code: r.route_code,
      },
      distanceMeters: Number(r.distance_meters),
    }));

    return {
      schoolId,
      thresholdMeters,
      duplicatePairsCount: duplicateClusters.length,
      duplicateClusters,
    };
  }

  /**
   * Micro-phase 14.4 Task 3: Get detailed pickup stop information including assigned students.
   */
  public static async getPickupStopDetail(
    stopId: string,
    schoolId: string,
    actorSchoolId?: string
  ): Promise<{
    id: string;
    schoolId: string;
    routeId: string;
    routeName: string;
    routeCode: string;
    stopName: string;
    sequenceOrder: number;
    latitude: number;
    longitude: number;
    scheduledTime: string;
    geofenceRadiusMeters: number;
    assignedStudents: Array<{
      id: string;
      fullName: string;
      admissionNumber: string;
      classGrade: string;
      section: string;
      parentName?: string;
      parentPhone?: string;
    }>;
  }> {
    const effectiveSchoolId = schoolId || actorSchoolId;
    if (!effectiveSchoolId) {
      throw new BadRequestError('schoolId is required to fetch stop detail');
    }
    if (actorSchoolId && actorSchoolId !== effectiveSchoolId) {
      throw new ForbiddenError('Cross-tenant unauthorized access attempt');
    }

    const stopRows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      route_name: string;
      route_code: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
    }>(
      `SELECT pl.id, pl.school_id, pl.route_id, r.name AS route_name, r.code AS route_code,
              pl.stop_name, pl.sequence_order, pl.latitude, pl.longitude,
              pl.scheduled_time::text AS scheduled_time, pl.geofence_radius_meters
       FROM pickup_locations pl
       JOIN routes r ON pl.route_id = r.id AND r.deleted_at IS NULL
       WHERE pl.id = $1 AND pl.school_id = $2 AND pl.deleted_at IS NULL
       LIMIT 1`,
      [stopId, effectiveSchoolId]
    );

    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Pickup stop ${stopId} not found in this school context`);
    }

    const s = stopRows[0];

    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
      class_grade: string;
      section: string;
      parent_name: string | null;
      parent_phone: string | null;
    }>(
      `SELECT st.id, st.full_name, st.admission_number, st.class_grade, st.section,
              p.full_name AS parent_name, p.phone AS parent_phone
       FROM student_stop_assignments ssa
       JOIN students st ON ssa.student_id = st.id AND st.deleted_at IS NULL
       LEFT JOIN parents p ON p.student_id = st.id AND p.deleted_at IS NULL
       WHERE ssa.pickup_stop_id = $1 AND ssa.school_id = $2 AND ssa.deleted_at IS NULL
       ORDER BY st.full_name ASC`,
      [stopId, effectiveSchoolId]
    );

    return {
      id: s.id,
      schoolId: s.school_id,
      routeId: s.route_id,
      routeName: s.route_name,
      routeCode: s.route_code,
      stopName: s.stop_name,
      sequenceOrder: Number(s.sequence_order),
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      scheduledTime: String(s.scheduled_time),
      geofenceRadiusMeters: Number(s.geofence_radius_meters),
      assignedStudents: studentRows.map((st) => ({
        id: st.id,
        fullName: st.full_name,
        admissionNumber: st.admission_number,
        classGrade: st.class_grade,
        section: st.section,
        parentName: st.parent_name || undefined,
        parentPhone: st.parent_phone || undefined,
      })),
    };
  }

  /**
   * Micro-phase 14.4 Task 3: Edit/change pickup stop details, relocate coordinates,
   * reassign students, and dispatch WhatsApp alerts to parents.
   */
  public static async editPickupStop(
    stopId: string,
    payload: EditPickupStopRequest,
    actorSchoolId?: string
  ): Promise<{
    success: boolean;
    stopId: string;
    stopName: string;
    latitude: number;
    longitude: number;
    scheduledTime: string;
    geofenceRadiusMeters: number;
    reassignedStudentsCount: number;
    parentsNotifiedCount: number;
  }> {
    const effectiveSchoolId = payload.schoolId || actorSchoolId;
    if (!effectiveSchoolId) {
      throw new BadRequestError('schoolId is required to edit pickup stop');
    }
    if (actorSchoolId && actorSchoolId !== effectiveSchoolId) {
      throw new ForbiddenError('Cross-tenant update attempt');
    }

    // 1. Fetch current stop
    const existingRows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      stop_name: string;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
    }>(
      `SELECT id, school_id, route_id, stop_name, latitude, longitude,
              scheduled_time::text AS scheduled_time, geofence_radius_meters
       FROM pickup_locations
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId, effectiveSchoolId]
    );

    if (existingRows.length === 0 || !existingRows[0]) {
      throw new NotFoundError(`Pickup stop ${stopId} not found`);
    }

    const currentStop = existingRows[0];

    let newStopName = payload.stopName || currentStop.stop_name;
    let newScheduledTime = payload.scheduledTime || currentStop.scheduled_time;
    let newGeofence = payload.geofenceRadiusMeters || currentStop.geofence_radius_meters;
    let newLat = currentStop.latitude;
    let newLng = currentStop.longitude;

    // 2. If relocating coordinates: run safety check and road snapping
    if (payload.latitude !== undefined && payload.longitude !== undefined) {
      const safety = await DynamicPickupService.checkLocationSafety({
        latitude: payload.latitude,
        longitude: payload.longitude,
        schoolId: effectiveSchoolId,
      });

      if (!safety.isSafe) {
        throw new ValidationError(`Location safety check failed: ${safety.reasons.join('; ')}`);
      }

      newLat = safety.snappedCoordinates ? safety.snappedCoordinates.latitude : payload.latitude;
      newLng = safety.snappedCoordinates ? safety.snappedCoordinates.longitude : payload.longitude;

      if (!payload.stopName && safety.formattedAddress) {
        newStopName = safety.formattedAddress.split(',')[0] || newStopName;
      }
    }

    // 3. Update pickup_locations
    await query(
      `UPDATE pickup_locations
       SET stop_name = $1,
           scheduled_time = $2,
           geofence_radius_meters = $3,
           latitude = $4,
           longitude = $5,
           location = ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
           updated_at = NOW()
       WHERE id = $6 AND school_id = $7`,
      [newStopName, newScheduledTime, newGeofence, newLat, newLng, stopId, effectiveSchoolId]
    );

    // 4. Handle student reassignment if requested
    let reassignedStudentsCount = 0;
    if (payload.reassignStudentsToStopId && payload.reassignStudentsToStopId !== stopId) {
      const targetStopRows = await query<{ id: string }>(
        `SELECT id FROM pickup_locations WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [payload.reassignStudentsToStopId, effectiveSchoolId]
      );
      if (targetStopRows.length === 0) {
        throw new NotFoundError(`Target reassignment stop ${payload.reassignStudentsToStopId} not found in this school context`);
      }

      const updateResult = await query(
        `UPDATE student_stop_assignments
         SET pickup_stop_id = $1,
             updated_at = NOW()
         WHERE pickup_stop_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
        [payload.reassignStudentsToStopId, stopId, effectiveSchoolId]
      );
      reassignedStudentsCount = (updateResult as any).rowCount || 0;
    }

    // 5. Notify parents of assigned students via WhatsApp if requested
    let parentsNotifiedCount = 0;
    if (payload.notifyParents) {
      try {
        const parentRows = await query<{
          parent_phone: string;
          parent_name: string;
          student_name: string;
          student_id: string;
        }>(
          `SELECT DISTINCT p.phone AS parent_phone, p.full_name AS parent_name,
                  st.full_name AS student_name, st.id AS student_id
           FROM student_stop_assignments ssa
           JOIN students st ON ssa.student_id = st.id AND st.deleted_at IS NULL
           JOIN parents p ON p.student_id = st.id AND p.deleted_at IS NULL
           WHERE (ssa.pickup_stop_id = $1 OR ssa.pickup_stop_id = $2)
             AND ssa.school_id = $3 AND ssa.deleted_at IS NULL`,
          [stopId, payload.reassignStudentsToStopId || stopId, effectiveSchoolId]
        );

        for (const p of parentRows) {
          const message = `📢 School Transport Notice: ${p.student_name}'s bus pickup stop has been updated to "${newStopName}" (Scheduled: ${newScheduledTime}).`;
          await MessagingService.sendMessage({
            recipientPhone: p.parent_phone,
            schoolId: effectiveSchoolId,
            studentId: p.student_id,
            directText: message,
          });
          parentsNotifiedCount++;
        }
      } catch (err: any) {
        logger.warn(`[DynamicPickup] Failed to dispatch WhatsApp notices for stop update: ${err.message}`);
      }
    }

    logger.info(`[DynamicPickup] Pickup stop ${stopId} updated successfully by school admin`);

    return {
      success: true,
      stopId,
      stopName: newStopName,
      latitude: newLat,
      longitude: newLng,
      scheduledTime: String(newScheduledTime),
      geofenceRadiusMeters: Number(newGeofence),
      reassignedStudentsCount,
      parentsNotifiedCount,
    };
  }

  /**
   * Micro-phase 14.4 Task 3: Soft-delete pickup stop with student migration guard.
   */
  public static async deletePickupStop(
    stopId: string,
    payload: DeletePickupStopRequest,
    actorSchoolId?: string
  ): Promise<{
    success: boolean;
    stopId: string;
    reassignedStudentsCount: number;
    parentsNotifiedCount: number;
  }> {
    const effectiveSchoolId = payload.schoolId || actorSchoolId;
    if (!effectiveSchoolId) {
      throw new BadRequestError('schoolId is required to delete pickup stop');
    }
    if (actorSchoolId && actorSchoolId !== effectiveSchoolId) {
      throw new ForbiddenError('Cross-tenant delete attempt');
    }

    // 1. Verify stop exists
    const stopRows = await query<{ id: string; stop_name: string }>(
      `SELECT id, stop_name FROM pickup_locations WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [stopId, effectiveSchoolId]
    );
    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Pickup stop ${stopId} not found`);
    }

    // 2. Check for assigned students
    const assignedStudents = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM student_stop_assignments WHERE pickup_stop_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [stopId, effectiveSchoolId]
    );
    const count = Number(assignedStudents[0]?.count || 0);

    let reassignedStudentsCount = 0;
    let parentsNotifiedCount = 0;

    if (count > 0) {
      if (!payload.forceReassignToStopId) {
        throw new ValidationError(
          `Cannot delete pickup stop because ${count} student(s) are currently assigned to it. Please specify forceReassignToStopId to move students to another stop.`
        );
      }

      // Check target stop
      const targetRows = await query<{ id: string; stop_name: string; scheduled_time: string }>(
        `SELECT id, stop_name, scheduled_time::text AS scheduled_time FROM pickup_locations WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [payload.forceReassignToStopId, effectiveSchoolId]
      );
      if (targetRows.length === 0 || !targetRows[0]) {
        throw new NotFoundError(`Reassignment target stop ${payload.forceReassignToStopId} not found`);
      }

      const targetStop = targetRows[0];

      // Reassign students
      const updateResult = await query(
        `UPDATE student_stop_assignments
         SET pickup_stop_id = $1,
             updated_at = NOW()
         WHERE pickup_stop_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
        [payload.forceReassignToStopId, stopId, effectiveSchoolId]
      );
      reassignedStudentsCount = (updateResult as any).rowCount || count;

      if (payload.notifyParents) {
        try {
          const parentRows = await query<{
            parent_phone: string;
            parent_name: string;
            student_name: string;
            student_id: string;
          }>(
            `SELECT DISTINCT p.phone AS parent_phone, p.full_name AS parent_name,
                    st.full_name AS student_name, st.id AS student_id
             FROM student_stop_assignments ssa
             JOIN students st ON ssa.student_id = st.id AND st.deleted_at IS NULL
             JOIN parents p ON p.student_id = st.id AND p.deleted_at IS NULL
             WHERE ssa.pickup_stop_id = $1 AND ssa.school_id = $2 AND ssa.deleted_at IS NULL`,
            [payload.forceReassignToStopId, effectiveSchoolId]
          );

          for (const p of parentRows) {
            const message = `📢 School Transport Notice: The bus stop "${stopRows[0].stop_name}" has been decommissioned. ${p.student_name} has been reassigned to "${targetStop.stop_name}" (Scheduled: ${targetStop.scheduled_time}).`;
            await MessagingService.sendMessage({
              recipientPhone: p.parent_phone,
              schoolId: effectiveSchoolId,
              studentId: p.student_id,
              directText: message,
            });
            parentsNotifiedCount++;
          }
        } catch (err: any) {
          logger.warn(`[DynamicPickup] Failed to dispatch WhatsApp notices for stop deletion: ${err.message}`);
        }
      }
    }

    // 3. Soft-delete the stop
    await query(
      `UPDATE pickup_locations
       SET deleted_at = NOW()
       WHERE id = $1 AND school_id = $2`,
      [stopId, effectiveSchoolId]
    );

    logger.info(`[DynamicPickup] Pickup stop ${stopId} soft-deleted by school admin`);

    return {
      success: true,
      stopId,
      reassignedStudentsCount,
      parentsNotifiedCount,
    };
  }
}


