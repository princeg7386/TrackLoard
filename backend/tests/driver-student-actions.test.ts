/**
 * Phase 19.3 — Driver Student Search: Actions
 *
 * File-content assertions verifying:
 * - url_launcher is imported in home_screen.dart
 * - _launchPhone and _launchMap helper methods exist
 * - tel: and geo: URI schemes are used
 * - LaunchMode.externalApplication is used for maps
 * - Action buttons: Call Parent, Open Map, Return to Roster
 * - _detailRow accepts an onTap parameter
 * - Navigator.of(ctx).pop() is used for sheet dismissal
 * - url_launcher is declared in pubspec.yaml
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const HOME_SCREEN = readFileSync(
  join(ROOT, 'driver-app', 'lib', 'screens', 'home_screen.dart'),
  'utf8',
);
const PUBSPEC = readFileSync(
  join(ROOT, 'driver-app', 'pubspec.yaml'),
  'utf8',
);

describe('Phase 19.3 — Driver Student Actions', () => {
  describe('pubspec.yaml', () => {
    it('declares url_launcher dependency', () => {
      expect(PUBSPEC).toMatch(/url_launcher:/);
    });
  });

  describe('home_screen.dart — imports', () => {
    it('imports url_launcher package', () => {
      expect(HOME_SCREEN).toContain("import 'package:url_launcher/url_launcher.dart'");
    });
  });

  describe('home_screen.dart — _launchPhone helper', () => {
    it('defines _launchPhone method', () => {
      expect(HOME_SCREEN).toContain('_launchPhone');
    });

    it('uses tel: URI scheme', () => {
      expect(HOME_SCREEN).toContain("'tel:");
    });

    it('shows SnackBar on dial failure', () => {
      expect(HOME_SCREEN).toContain('Could not open phone dialer.');
    });
  });

  describe('home_screen.dart — _launchMap helper', () => {
    it('defines _launchMap method', () => {
      expect(HOME_SCREEN).toContain('_launchMap');
    });

    it('uses geo: URI scheme', () => {
      expect(HOME_SCREEN).toContain("'geo:");
    });

    it('uses LaunchMode.externalApplication for maps', () => {
      expect(HOME_SCREEN).toContain('LaunchMode.externalApplication');
    });

    it('includes Google Maps fallback URL', () => {
      expect(HOME_SCREEN).toContain('google.com/maps/search');
    });

    it('shows SnackBar on map failure', () => {
      expect(HOME_SCREEN).toContain('Could not open maps app.');
    });
  });

  describe('home_screen.dart — _detailRow onTap parameter', () => {
    it('_detailRow signature includes onTap parameter', () => {
      expect(HOME_SCREEN).toMatch(/VoidCallback\?\s+onTap/);
    });

    it('wraps value text in GestureDetector when onTap provided', () => {
      expect(HOME_SCREEN).toContain('GestureDetector');
    });
  });

  describe('home_screen.dart — action buttons', () => {
    it('has Call Parent button', () => {
      expect(HOME_SCREEN).toContain('Call Parent');
    });

    it('has Open Map button', () => {
      expect(HOME_SCREEN).toContain('Open Map');
    });

    it('has Return to Roster button', () => {
      expect(HOME_SCREEN).toContain('Return to Roster');
    });
  });

  describe('home_screen.dart — sheet navigation', () => {
    it('uses Navigator.of(ctx).pop() to dismiss the bottom sheet', () => {
      expect(HOME_SCREEN).toContain('Navigator.of(ctx).pop()');
    });
  });
});
