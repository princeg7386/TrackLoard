/// Formatting helper utilities for UI display
class AppFormatters {
  /// Format phone number into readable format +91 XXXXX XXXXX
  static String formatPhoneNumber(String phone) {
    final clean = phone.replaceAll(RegExp(r'\D'), '');
    if (clean.length == 10) {
      return '+91 ${clean.substring(0, 5)} ${clean.substring(5)}';
    } else if (clean.length == 12 && clean.startsWith('91')) {
      return '+91 ${clean.substring(2, 7)} ${clean.substring(7)}';
    }
    return phone;
  }

  /// Format 24-hour time "07:30:00" or "07:30" to "07:30 AM"
  static String formatTime(String? timeStr) {
    if (timeStr == null || timeStr.isEmpty) return '--:--';
    try {
      final parts = timeStr.split(':');
      if (parts.length < 2) return timeStr;
      int hour = int.parse(parts[0]);
      final minute = parts[1].padLeft(2, '0');
      final period = hour >= 12 ? 'PM' : 'AM';
      if (hour == 0) {
        hour = 12;
      } else if (hour > 12) {
        hour -= 12;
      }
      return '${hour.toString().padLeft(2, '0')}:$minute $period';
    } catch (_) {
      return timeStr;
    }
  }

  /// Format date string "2026-10-10" to readable "10 Oct 2026"
  static String formatDate(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return '--';
    try {
      final date = DateTime.parse(dateStr);
      final months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      return '${date.day} ${months[date.month - 1]} ${date.year}';
    } catch (_) {
      return dateStr;
    }
  }

  /// Humanize trip status string
  static String formatTripStatus(String status) {
    switch (status.toUpperCase()) {
      case 'SCHEDULED':
        return 'Scheduled';
      case 'IN_TRANSIT':
        return 'In Transit';
      case 'DELAYED':
        return 'Delayed';
      case 'ARRIVED_SCHOOL':
        return 'Arrived at School';
      case 'COMPLETED':
        return 'Completed';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return status;
    }
  }
}
