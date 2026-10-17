/// Model representing pickup stop information for a student
class StudentPickupStopInfo {
  final String id;
  final String name;
  final int sequenceOrder;
  final int? expectedTimeOffsetMinutes;
  final double latitude;
  final double longitude;
  final String? address;

  StudentPickupStopInfo({
    required this.id,
    required this.name,
    required this.sequenceOrder,
    this.expectedTimeOffsetMinutes,
    required this.latitude,
    required this.longitude,
    this.address,
  });

  factory StudentPickupStopInfo.fromJson(Map<String, dynamic> json) {
    return StudentPickupStopInfo(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      sequenceOrder: (json['sequenceOrder'] as num?)?.toInt() ?? 1,
      expectedTimeOffsetMinutes: (json['expectedTimeOffsetMinutes'] as num?)?.toInt(),
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      address: json['address']?.toString(),
    );
  }
}

/// Model representing parent / guardian details for a student
class StudentParentInfo {
  final String fullName;
  final String phone;
  final String? relationship;

  StudentParentInfo({
    required this.fullName,
    required this.phone,
    this.relationship,
  });

  factory StudentParentInfo.fromJson(Map<String, dynamic> json) {
    return StudentParentInfo(
      fullName: json['fullName']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      relationship: json['relationship']?.toString(),
    );
  }
}

/// Model representing a student attendance item in the driver roster
class StudentAttendanceItem {
  final String studentId;
  final String admissionNumber;
  final String fullName;
  final String? grade;
  final String? section;
  final String? emergencyPhone;
  final StudentPickupStopInfo pickupStop;
  final StudentPickupStopInfo? dropStop;
  final StudentParentInfo? parent;
  final String attendanceStatus; // PENDING, BOARDED, ABSENT, DEBOARDED
  final String? boardedAt;
  final String? droppedAt;
  final String? markedBy;

  StudentAttendanceItem({
    required this.studentId,
    required this.admissionNumber,
    required this.fullName,
    this.grade,
    this.section,
    this.emergencyPhone,
    required this.pickupStop,
    this.dropStop,
    this.parent,
    required this.attendanceStatus,
    this.boardedAt,
    this.droppedAt,
    this.markedBy,
  });

  factory StudentAttendanceItem.fromJson(Map<String, dynamic> json) {
    return StudentAttendanceItem(
      studentId: json['studentId']?.toString() ?? '',
      admissionNumber: json['admissionNumber']?.toString() ?? '',
      fullName: json['fullName']?.toString() ?? '',
      grade: json['grade']?.toString(),
      section: json['section']?.toString(),
      emergencyPhone: json['emergencyPhone']?.toString(),
      pickupStop: StudentPickupStopInfo.fromJson(json['pickupStop'] as Map<String, dynamic>? ?? {}),
      dropStop: json['dropStop'] != null ? StudentPickupStopInfo.fromJson(json['dropStop'] as Map<String, dynamic>) : null,
      parent: json['parent'] != null ? StudentParentInfo.fromJson(json['parent'] as Map<String, dynamic>) : null,
      attendanceStatus: json['attendanceStatus']?.toString() ?? 'PENDING',
      boardedAt: json['boardedAt']?.toString(),
      droppedAt: json['droppedAt']?.toString(),
      markedBy: json['markedBy']?.toString(),
    );
  }
}

/// Model representing the full student roster returned by the backend
class DriverStudentListModel {
  final String? tripId;
  final String busId;
  final String busNumber;
  final String registrationNumber;
  final String? routeId;
  final String? routeName;
  final String? routeCode;
  final int totalStudents;
  final int boardedCount;
  final int droppedCount;
  final int absentCount;
  final int pendingCount;
  final List<StudentAttendanceItem> students;

  DriverStudentListModel({
    this.tripId,
    required this.busId,
    required this.busNumber,
    required this.registrationNumber,
    this.routeId,
    this.routeName,
    this.routeCode,
    required this.totalStudents,
    required this.boardedCount,
    required this.droppedCount,
    required this.absentCount,
    required this.pendingCount,
    required this.students,
  });

  factory DriverStudentListModel.fromJson(Map<String, dynamic> json) {
    final list = (json['students'] as List<dynamic>?) ?? [];
    return DriverStudentListModel(
      tripId: json['tripId']?.toString(),
      busId: json['busId']?.toString() ?? '',
      busNumber: json['busNumber']?.toString() ?? '',
      registrationNumber: json['registrationNumber']?.toString() ?? '',
      routeId: json['routeId']?.toString(),
      routeName: json['routeName']?.toString(),
      routeCode: json['routeCode']?.toString(),
      totalStudents: (json['totalStudents'] as num?)?.toInt() ?? 0,
      boardedCount: (json['boardedCount'] as num?)?.toInt() ?? 0,
      droppedCount: (json['droppedCount'] as num?)?.toInt() ?? 0,
      absentCount: (json['absentCount'] as num?)?.toInt() ?? 0,
      pendingCount: (json['pendingCount'] as num?)?.toInt() ?? 0,
      students: list.map((item) => StudentAttendanceItem.fromJson(item as Map<String, dynamic>)).toList(),
    );
  }
}
