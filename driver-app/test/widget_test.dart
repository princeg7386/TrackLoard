import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:school_bus_driver_app/main.dart';
import 'package:school_bus_driver_app/screens/login_screen.dart';
import 'package:school_bus_driver_app/screens/splash_screen.dart';
import 'package:school_bus_driver_app/services/app_lifecycle_manager.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Driver app smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const DriverTelemetryApp());
    expect(find.byType(MaterialApp), findsOneWidget);
  });

  testWidgets('SplashScreen cancels timer on dispose before timeout', (WidgetTester tester) async {
    // Mount splash screen inside MaterialApp
    await tester.pumpWidget(
      const MaterialApp(
        home: SplashScreen(),
      ),
    );
    expect(find.byType(SplashScreen), findsOneWidget);

    // Unmount before 600ms timeout by replacing with an empty container
    await tester.pumpWidget(
      const MaterialApp(
        home: SizedBox.shrink(),
      ),
    );
    expect(find.byType(SplashScreen), findsNothing);

    // Verify advancing virtual time does not trigger timer callbacks or exceptions
    await tester.pump(const Duration(milliseconds: 1000));
  });

  testWidgets('SplashScreen transitions to LoginScreen when timeout completes', (WidgetTester tester) async {
    await tester.pumpWidget(const DriverTelemetryApp());
    expect(find.byType(SplashScreen), findsOneWidget);

    // Advance clock past the 600ms splash delay
    await tester.pump(const Duration(milliseconds: 700));
    // Allow async SharedPreferences Future to complete and schedule navigation
    await tester.pump(const Duration(milliseconds: 100));
    // Animate the route transition to LoginScreen
    await tester.pump(const Duration(milliseconds: 300));

    // Verify navigated to LoginScreen
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  test('AppLifecycleManager dispose is safe and idempotent when called repeatedly', () {
    final manager = AppLifecycleManager();
    expect(() {
      manager.dispose();
      manager.dispose();
    }, returnsNormally);
  });
}
