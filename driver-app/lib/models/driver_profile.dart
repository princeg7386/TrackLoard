/// Model representing an assigned bus for a driver
class DriverAssignedBus {
  final String id;
  final String registrationNumber;
  final String busNumber;
  final String? makeModel;

  DriverAssignedBus({
    required this.id,
    required this.registrationNumber,
    required this.busNumber,
    this.makeModel,
  });

  factory DriverAssignedBus.fromJson(Map<String, dynamic> json) {
    return DriverAssignedBus(
      id: json['id']?.toString() ?? '',
      registrationNumber: json['registrationNumber']?.toString() ?? '',
      busNumber: json['busNumber']?.toString() ?? '',
      makeModel: json['makeModel']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'registrationNumber': registrationNumber,
      'busNumber': busNumber,
      'makeModel': makeModel,
    };
  }
}

/// Model representing driver authentication user info
class DriverUser {
  final String id;
  final String schoolId;
  final String phone;
  final String fullName;
  final String role;
  final String? assignedBusId;

  DriverUser({
    required this.id,
    required this.schoolId,
    required this.phone,
    required this.fullName,
    required this.role,
    this.assignedBusId,
  });

  factory DriverUser.fromJson(Map<String, dynamic> json) {
    return DriverUser(
      id: json['id']?.toString() ?? '',
      schoolId: json['schoolId']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      fullName: json['fullName']?.toString() ?? '',
      role: json['role']?.toString() ?? 'DRIVER',
      assignedBusId: json['assignedBusId']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'schoolId': schoolId,
      'phone': phone,
      'fullName': fullName,
      'role': role,
      'assignedBusId': assignedBusId,
    };
  }
}

/// Model representing the full Driver Profile response including assignments and trips
class DriverProfileData {
  final DriverUser driver;
  final DriverAssignedBus? assignedBus;
  final Map<String, dynamic>? activeTrip;
  final List<Map<String, dynamic>> todayTrips;

  DriverProfileData({
    required this.driver,
    this.assignedBus,
    this.activeTrip,
    required this.todayTrips,
  });

  factory DriverProfileData.fromJson(Map<String, dynamic> json) {
    return DriverProfileData(
      driver: DriverUser.fromJson(json['driver'] is Map<String, dynamic> ? json['driver'] : {}),
      assignedBus: json['assignedBus'] != null && json['assignedBus'] is Map<String, dynamic>
          ? DriverAssignedBus.fromJson(json['assignedBus'])
          : null,
      activeTrip: json['activeTrip'] is Map<String, dynamic> ? json['activeTrip'] : null,
      todayTrips: json['todayTrips'] is List
          ? (json['todayTrips'] as List).whereType<Map<String, dynamic>>().toList()
          : [],
    );
  }
}
