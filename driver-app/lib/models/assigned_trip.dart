/// Model representing a scheduled or active trip for the driver
class AssignedTrip {
  final String id;
  final String schoolId;
  final String routeId;
  final String busId;
  final String driverId;
  final String status;
  final String scheduledDate;
  final String scheduledStartTime;
  final String? actualStartTime;
  final String? actualEndTime;
  final int currentStopSequence;
  final int delayMinutes;
  final String? routeName;
  final String? tripType; // 'PICKUP' | 'DROP'
  final int totalStops;

  AssignedTrip({
    required this.id,
    required this.schoolId,
    required this.routeId,
    required this.busId,
    required this.driverId,
    required this.status,
    required this.scheduledDate,
    required this.scheduledStartTime,
    this.actualStartTime,
    this.actualEndTime,
    this.currentStopSequence = 0,
    this.delayMinutes = 0,
    this.routeName,
    this.tripType,
    this.totalStops = 0,
  });

  factory AssignedTrip.fromJson(Map<String, dynamic> json) {
    return AssignedTrip(
      id: json['id']?.toString() ?? '',
      schoolId: json['schoolId']?.toString() ?? '',
      routeId: json['routeId']?.toString() ?? '',
      busId: json['busId']?.toString() ?? '',
      driverId: json['driverId']?.toString() ?? '',
      status: json['status']?.toString() ?? 'SCHEDULED',
      scheduledDate: json['scheduledDate']?.toString() ?? '',
      scheduledStartTime: json['scheduledStartTime']?.toString() ?? '',
      actualStartTime: json['actualStartTime']?.toString(),
      actualEndTime: json['actualEndTime']?.toString(),
      currentStopSequence: json['currentStopSequence'] is int
          ? json['currentStopSequence']
          : int.tryParse(json['currentStopSequence']?.toString() ?? '0') ?? 0,
      delayMinutes: json['delayMinutes'] is int
          ? json['delayMinutes']
          : int.tryParse(json['delayMinutes']?.toString() ?? '0') ?? 0,
      routeName: json['routeName']?.toString() ?? (json['routeId'] != null ? 'Route ${json['routeId'].toString().substring(0, 4.clamp(0, json['routeId'].toString().length))}' : 'Scheduled Route'),
      tripType: json['tripType']?.toString() ?? 'PICKUP',
      totalStops: json['totalStops'] is int
          ? json['totalStops']
          : int.tryParse(json['totalStops']?.toString() ?? '0') ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'schoolId': schoolId,
      'routeId': routeId,
      'busId': busId,
      'driverId': driverId,
      'status': status,
      'scheduledDate': scheduledDate,
      'scheduledStartTime': scheduledStartTime,
      'actualStartTime': actualStartTime,
      'actualEndTime': actualEndTime,
      'currentStopSequence': currentStopSequence,
      'delayMinutes': delayMinutes,
      'routeName': routeName,
      'tripType': tripType,
      'totalStops': totalStops,
    };
  }
}
