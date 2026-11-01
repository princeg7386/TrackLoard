/// Models for the Pickup Arrival — Upcoming Students response (Phase 31.1 & 31.3)
///
/// Maps to the JSON shape returned by Route 117 & Route 118:
/// GET  /api/v1/schools/:schoolId/trips/:tripId/upcoming-students
/// POST /api/v1/schools/:schoolId/trips/:tripId/stops/:stopId/arrival
library upcoming_students_model;

/// Represents the next stop on the route that still has pending pickups.
class UpcomingStop {
  final String id;
  final String name;
  final int sequenceOrder;
  final double latitude;
  final double longitude;
  final String? scheduledTime;
  final int geofenceRadiusMeters;
  final bool isAtStop;
  final String? arrivedAt;

  const UpcomingStop({
    required this.id,
    required this.name,
    required this.sequenceOrder,
    required this.latitude,
    required this.longitude,
    this.scheduledTime,
    required this.geofenceRadiusMeters,
    this.isAtStop = false,
    this.arrivedAt,
  });

  factory UpcomingStop.fromJson(Map<String, dynamic> json) {
    return UpcomingStop(
      id: json['id'] as String,
      name: json['name'] as String,
      sequenceOrder: json['sequenceOrder'] as int,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      scheduledTime: json['scheduledTime'] as String?,
      geofenceRadiusMeters: json['geofenceRadiusMeters'] as int,
      isAtStop: json['isAtStop'] as bool? ?? false,
      arrivedAt: json['arrivedAt'] as String?,
    );
  }
}

/// Represents a single student at the upcoming stop.
class UpcomingStudentItem {
  final String studentId;
  final String fullName;
  final String admissionNumber;
  final String classGrade;
  final String section;
  final String? parentPhone;

  /// One of: PENDING, BOARDED, ABSENT, SKIPPED
  final String attendanceStatus;
  final String? boardedAt;

  const UpcomingStudentItem({
    required this.studentId,
    required this.fullName,
    required this.admissionNumber,
    required this.classGrade,
    required this.section,
    this.parentPhone,
    required this.attendanceStatus,
    this.boardedAt,
  });

  factory UpcomingStudentItem.fromJson(Map<String, dynamic> json) {
    return UpcomingStudentItem(
      studentId: json['studentId'] as String,
      fullName: json['fullName'] as String,
      admissionNumber: json['admissionNumber'] as String,
      classGrade: json['classGrade'] as String,
      section: json['section'] as String,
      parentPhone: json['parentPhone'] as String?,
      attendanceStatus: json['attendanceStatus'] as String,
      boardedAt: json['boardedAt'] as String?,
    );
  }
}

/// Top-level response from the upcoming-students endpoint.
class UpcomingPickupResult {
  final String tripId;
  final String schoolId;
  final String tripStatus;
  final int currentStopSequence;
  final UpcomingStop? nextStop;
  final List<UpcomingStudentItem> students;
  final int totalPending;
  final int totalAtStop;
  final bool allPickupsComplete;
  final bool isAtStop;
  final bool boardingAvailable;
  final String? arrivedAt;

  const UpcomingPickupResult({
    required this.tripId,
    required this.schoolId,
    required this.tripStatus,
    required this.currentStopSequence,
    this.nextStop,
    required this.students,
    required this.totalPending,
    required this.totalAtStop,
    required this.allPickupsComplete,
    this.isAtStop = false,
    this.boardingAvailable = false,
    this.arrivedAt,
  });

  factory UpcomingPickupResult.fromJson(Map<String, dynamic> json) {
    final nextStopJson = json['nextStop'] as Map<String, dynamic>?;
    final studentsJson = json['students'] as List<dynamic>? ?? [];

    return UpcomingPickupResult(
      tripId: json['tripId'] as String,
      schoolId: json['schoolId'] as String,
      tripStatus: json['tripStatus'] as String,
      currentStopSequence: json['currentStopSequence'] as int,
      nextStop: nextStopJson != null ? UpcomingStop.fromJson(nextStopJson) : null,
      students: studentsJson
          .map((e) => UpcomingStudentItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalPending: json['totalPending'] as int,
      totalAtStop: json['totalAtStop'] as int,
      allPickupsComplete: json['allPickupsComplete'] as bool,
      isAtStop: json['isAtStop'] as bool? ?? false,
      boardingAvailable: json['boardingAvailable'] as bool? ?? false,
      arrivedAt: json['arrivedAt'] as String?,
    );
  }
}
