/// Trip lifecycle state enumeration
enum TripLifecycleStatus {
  scheduled,
  inTransit,
  delayed,
  completed,
  cancelled,
}

/// Detailed real-time model of active trip execution progress
class ActiveTripProgress {
  final String tripId;
  final String schoolId;
  final String busId;
  final String busNumber;
  final String routeId;
  final String routeName;
  final String tripType; // 'PICKUP' | 'DROP'
  final TripLifecycleStatus status;
  final String scheduledStartTime;
  final DateTime? actualStartTime;
  final DateTime? actualEndTime;
  final int totalStops;
  final int currentStopSequence;
  final String? currentStopName;
  final String? nextStopName;
  final int delayMinutes;
  final int studentsBoarded;
  final int totalAssignedStudents;

  const ActiveTripProgress({
    required this.tripId,
    required this.schoolId,
    required this.busId,
    required this.busNumber,
    required this.routeId,
    required this.routeName,
    this.tripType = 'PICKUP',
    this.status = TripLifecycleStatus.scheduled,
    required this.scheduledStartTime,
    this.actualStartTime,
    this.actualEndTime,
    this.totalStops = 0,
    this.currentStopSequence = 0,
    this.currentStopName,
    this.nextStopName,
    this.delayMinutes = 0,
    this.studentsBoarded = 0,
    this.totalAssignedStudents = 0,
  });

  factory ActiveTripProgress.fromJson(Map<String, dynamic> json) {
    TripLifecycleStatus parsedStatus;
    final rawStatus = json['status']?.toString().toUpperCase() ?? 'SCHEDULED';
    switch (rawStatus) {
      case 'IN_TRANSIT':
        parsedStatus = TripLifecycleStatus.inTransit;
        break;
      case 'DELAYED':
        parsedStatus = TripLifecycleStatus.delayed;
        break;
      case 'COMPLETED':
        parsedStatus = TripLifecycleStatus.completed;
        break;
      case 'CANCELLED':
        parsedStatus = TripLifecycleStatus.cancelled;
        break;
      case 'SCHEDULED':
      default:
        parsedStatus = TripLifecycleStatus.scheduled;
    }

    return ActiveTripProgress(
      tripId: json['id']?.toString() ?? json['tripId']?.toString() ?? '',
      schoolId: json['schoolId']?.toString() ?? '',
      busId: json['busId']?.toString() ?? '',
      busNumber: json['busNumber']?.toString() ?? 'BUS',
      routeId: json['routeId']?.toString() ?? '',
      routeName: json['routeName']?.toString() ?? 'Scheduled Route',
      tripType: json['tripType']?.toString() ?? 'PICKUP',
      status: parsedStatus,
      scheduledStartTime: json['scheduledStartTime']?.toString() ?? '--:--',
      actualStartTime: json['actualStartTime'] != null
          ? DateTime.tryParse(json['actualStartTime'].toString())
          : null,
      actualEndTime: json['actualEndTime'] != null
          ? DateTime.tryParse(json['actualEndTime'].toString())
          : null,
      totalStops: json['totalStops'] is int
          ? json['totalStops']
          : int.tryParse(json['totalStops']?.toString() ?? '0') ?? 0,
      currentStopSequence: json['currentStopSequence'] is int
          ? json['currentStopSequence']
          : int.tryParse(json['currentStopSequence']?.toString() ?? '0') ?? 0,
      currentStopName: json['currentStopName']?.toString(),
      nextStopName: json['nextStopName']?.toString(),
      delayMinutes: json['delayMinutes'] is int
          ? json['delayMinutes']
          : int.tryParse(json['delayMinutes']?.toString() ?? '0') ?? 0,
      studentsBoarded: json['studentsBoarded'] is int
          ? json['studentsBoarded']
          : int.tryParse(json['studentsBoarded']?.toString() ?? '0') ?? 0,
      totalAssignedStudents: json['totalAssignedStudents'] is int
          ? json['totalAssignedStudents']
          : int.tryParse(json['totalAssignedStudents']?.toString() ?? '0') ?? 0,
    );
  }

  /// Progress fraction from 0.0 to 1.0 along the route stops
  double get progressFraction {
    if (totalStops <= 0) return 0.0;
    final progress = currentStopSequence / totalStops;
    return progress.clamp(0.0, 1.0);
  }

  /// Human readable status string
  String get statusLabel {
    switch (status) {
      case TripLifecycleStatus.inTransit:
        return 'In Transit';
      case TripLifecycleStatus.delayed:
        return 'Delayed (+${delayMinutes}m)';
      case TripLifecycleStatus.completed:
        return 'Completed';
      case TripLifecycleStatus.cancelled:
        return 'Cancelled';
      case TripLifecycleStatus.scheduled:
      default:
        return 'Scheduled';
    }
  }

  /// Whether trip is actively running
  bool get isActive =>
      status == TripLifecycleStatus.inTransit ||
      status == TripLifecycleStatus.delayed;
}
